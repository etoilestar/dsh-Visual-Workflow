import type { GraphNode, Line, WorkflowDocument } from "../shared/graph-model.js"
import type { SemanticIssue, SemanticIssueType, SemanticReviewOutcome, SemanticReviewResult } from "./types.js"

export interface AgentDefaultModelLike {
  currentSelection(): { provider: string; model: string } | null
}

export interface LlmLike {
  stream(input: { provider: string; model: string; messages: Array<{ role: "system" | "user"; content: string }> }): AsyncIterable<unknown>
}

export interface SemanticReviewerRuntime {
  agentDefaultModel?: AgentDefaultModelLike | null | (() => AgentDefaultModelLike | null)
  llm?: LlmLike | null | (() => LlmLike | null)
  logger?: { error(message: string): void }
}

export interface SemanticWorkflowView {
  nodes: Array<Record<string, unknown>>
  lines: Array<{ source: string; target: string; channel: "flow" | "ctx" | "db"; condition?: unknown }>
}

const ISSUE_TYPES = new Set<SemanticIssueType>([
  "requirement_uncovered",
  "requirement_partially_covered",
  "responsibility_overlap",
  "dataflow_semantic_mismatch",
])

export function buildSemanticWorkflowView(flow: WorkflowDocument): SemanticWorkflowView {
  return {
    nodes: (flow.nodes ?? []).map((node) => semanticNodeView(node)),
    lines: (flow.lines ?? []).map((line) => semanticLineView(line)),
  }
}

function semanticNodeView(node: GraphNode): Record<string, unknown> {
  const data = "data" in node && node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {}
  const view: Record<string, unknown> = { id: node.id, kind: node.kind }
  for (const key of ["label", "systemPrompt", "outputSchema", "collabPrompt", "memberIds"] as const) {
    if (data[key] !== undefined) view[key] = data[key]
  }
  if (node.kind === "proxy") view.proxySourceId = node.proxySourceId
  return view
}

function semanticLineView(line: Line): SemanticWorkflowView["lines"][number] {
  const channel = line.sourceHandle === "db-out" || line.targetHandle === "db-in"
    ? "db"
    : line.sourceHandle === "ctx-out" || line.targetHandle === "ctx-in" ? "ctx" : "flow"
  return {
    source: line.source,
    target: line.target,
    channel,
    ...(line.condition ? { condition: line.condition } : {}),
  }
}

export const SEMANTIC_REVIEWER_PROMPT = `你是只读 workflow semantic reviewer；你没有设计该 workflow，也不能返回 graph patch。
Requirement source authority：所有 requirement 只能来自 originalUserIntent。创建 requirement 前必须能指出是哪条原始意图证明它存在；不能证明就不要创建。workflow 仅是实现证据，不能反推出需求。
只检查 requirement_uncovered、requirement_partially_covered、responsibility_overlap、dataflow_semantic_mismatch。职责轻微交叉不算 overlap，只有核心业务责任高度重叠才报告，且 responsibility_overlap 必须为 warning；其他三类明确问题为 error。
dataflow 只把 ctx、db 或明确 outputSchema 当作真实数据交接；普通 flow 线只代表顺序，不能当数据传输。
禁止重新设计 workflow，禁止仅为最佳实践要求 validator、retry、synchronizer、feedback loop、aggregator 或额外 robustness mechanism，除非原始需求明确要求。
SUFFICIENCY STOP RULE：明确需求已覆盖、核心职责无明显冲突、必要数据交接成立就 PASS，不继续寻找可优化项。
只输出严格 JSON：{"passed":boolean,"requirements":[{"id":string,"text":string,"ownerNodeIds":string[]}],"issues":[{"type":string,"level":"error"|"warning","requirementIds":string[],"affectedNodeIds":string[],"reason":string,"evidence":string,"repairGuidance":string}]}。passed=true 时不得有 error。requirement id 必须唯一，所有节点 id 必须来自 workflow。`

export class SemanticReviewer {
  constructor(private readonly runtime: SemanticReviewerRuntime) {}

  async review(originalUserIntent: string, flow: WorkflowDocument): Promise<SemanticReviewOutcome> {
    const modelService = typeof this.runtime.agentDefaultModel === "function"
      ? this.runtime.agentDefaultModel()
      : this.runtime.agentDefaultModel
    const llm = typeof this.runtime.llm === "function" ? this.runtime.llm() : this.runtime.llm
    const selection = modelService?.currentSelection()
    if (!selection || !llm) return this.unavailable("LLM 或默认模型服务不可用")
    const input = JSON.stringify({ originalUserIntent, workflow: buildSemanticWorkflowView(flow) })
    let protocolError = ""
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const content = await collectText(llm.stream({
          provider: selection.provider,
          model: selection.model,
          messages: [
            { role: "system", content: SEMANTIC_REVIEWER_PROMPT },
            { role: "user", content: attempt === 0 ? input : `只修复上一响应的 JSON protocol shape，不改变语义判断。原始输入：${input}\n协议错误：${protocolError}` },
          ],
        }))
        return { available: true, result: parseSemanticReview(content, flow) }
      } catch (error) {
        protocolError = error instanceof Error ? error.message : String(error)
      }
    }
    return this.unavailable(`semantic reviewer protocol 连续两次无效：${protocolError}`)
  }

  private unavailable(reason: string): SemanticReviewOutcome {
    this.runtime.logger?.error(`[visual-workflow] semantic review unavailable: ${reason}`)
    return { available: false, unavailableReason: reason }
  }
}

async function collectText(stream: AsyncIterable<unknown>): Promise<string> {
  let text = ""
  for await (const chunk of stream) text += textOfChunk(chunk)
  return text.trim()
}

function textOfChunk(chunk: unknown): string {
  if (typeof chunk === "string") return chunk
  if (!chunk || typeof chunk !== "object") return ""
  const value = chunk as Record<string, unknown>
  if (typeof value.text === "string") return value.text
  if (typeof value.delta === "string") return value.delta
  if (typeof value.content === "string") return value.content
  const delta = value.delta as Record<string, unknown> | undefined
  return typeof delta?.content === "string" ? delta.content : ""
}

export function parseSemanticReview(text: string, flow: WorkflowDocument): SemanticReviewResult {
  const value = JSON.parse(text.trim()) as Record<string, unknown>
  assertOnlyKeys(value, ["passed", "requirements", "issues"], "response")
  if (typeof value.passed !== "boolean" || !Array.isArray(value.requirements) || !Array.isArray(value.issues)) {
    throw new Error("响应缺少 passed/requirements/issues")
  }
  const nodeIds = new Set((flow.nodes ?? []).map((node) => node.id))
  const requirements = value.requirements.map((raw) => {
    const item = objectOf(raw, "requirement")
    assertOnlyKeys(item, ["id", "text", "ownerNodeIds"], "requirement")
    const id = requiredString(item.id, "requirement.id")
    return { id, text: requiredString(item.text, "requirement.text"), ownerNodeIds: nodeIdArray(item.ownerNodeIds, nodeIds, "ownerNodeIds") }
  })
  const requirementIds = new Set(requirements.map((item) => item.id))
  if (requirementIds.size !== requirements.length) throw new Error("requirement id 必须唯一")
  const issues = value.issues.map((raw) => parseIssue(raw, nodeIds, requirementIds))
  if (value.passed && issues.some((issue) => issue.level === "error")) throw new Error("passed=true 不能包含 error")
  if (!value.passed && !issues.some((issue) => issue.level === "error")) throw new Error("passed=false 必须包含 error")
  return { passed: value.passed, requirements, issues }
}

function parseIssue(raw: unknown, nodeIds: Set<string>, requirementIds: Set<string>): SemanticIssue {
  const item = objectOf(raw, "issue")
  assertOnlyKeys(item, ["type", "level", "requirementIds", "affectedNodeIds", "reason", "evidence", "repairGuidance"], "issue")
  const type = String(item.type ?? "") as SemanticIssueType
  if (!ISSUE_TYPES.has(type)) throw new Error(`未知 issue type: ${type}`)
  const level = item.level
  if (level !== "error" && level !== "warning") throw new Error("未知 issue level")
  if ((type === "responsibility_overlap") !== (level === "warning")) throw new Error(`${type} 的 level 不符合策略`)
  const refs = stringArray(item.requirementIds, "requirementIds")
  if (refs.some((id) => !requirementIds.has(id))) throw new Error("issue 引用了未知 requirement")
  return {
    type,
    level,
    requirementIds: refs,
    affectedNodeIds: nodeIdArray(item.affectedNodeIds, nodeIds, "affectedNodeIds"),
    reason: requiredString(item.reason, "reason"),
    evidence: requiredString(item.evidence, "evidence"),
    repairGuidance: requiredString(item.repairGuidance, "repairGuidance"),
  }
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function assertOnlyKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key))
  if (unknown.length > 0) throw new Error(`${label} 含未知字段：${unknown.join(",")}`)
}

function requiredString(value: unknown, label: string): string {
  const out = typeof value === "string" ? value.trim() : ""
  if (!out) throw new Error(`${label} 必须是非空字符串`)
  return out
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} 必须是字符串数组`)
  return value as string[]
}

function nodeIdArray(value: unknown, nodeIds: Set<string>, label: string): string[] {
  const ids = stringArray(value, label)
  if (ids.some((id) => !nodeIds.has(id))) throw new Error(`${label} 引用了 candidate 中不存在的节点`)
  return ids
}
