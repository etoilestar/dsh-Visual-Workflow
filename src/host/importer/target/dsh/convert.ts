import type { GraphNode, Line, RoleNode, WorkflowTemplate } from "../../../shared/graph-model.js"
import type {
  WorkflowImportDependency,
  WorkflowImportIssue,
  WorkflowImportMetadata,
  WorkflowImportStatus,
} from "../../../shared/workflow-import.js"
import { checkGraphInvariants, stageLabel, validateFlow } from "../../../graph/index.js"
import type { SourceDependencyIR, SourceEdgeIR, SourceNodeIR, SourceWorkflowIR } from "../../ir/source-ir.js"
import type { DifyCapabilities } from "../../source/dify/normalize.js"

export interface DshImportConversion {
  template: WorkflowTemplate
  report: WorkflowImportMetadata
}

const directlyMappedKinds = new Set(["start", "end", "llm", "agent"])
const blockingKinds = new Set(["unknown", "loop", "iteration"])

export function convertDifyWorkflow(
  source: SourceWorkflowIR,
  capabilities: DifyCapabilities,
  options: { id: string; name?: string; importedAt?: string },
): DshImportConversion {
  const issues: WorkflowImportIssue[] = []
  const nodes = source.nodes.map((node, index) => convertNode(node, index, issues))
  const lines = source.edges.map((edge) => convertEdge(edge))
  collectSourceIssues(source, capabilities, issues)

  const importedAt = options.importedAt ?? new Date().toISOString()
  const draft: WorkflowTemplate = {
    id: options.id,
    mode: "mode1",
    executionMode: "agent",
    name: options.name ?? source.name,
    description: source.description ?? "",
    revision: 0,
    nodes,
    lines,
    createdAt: importedAt,
    updatedAt: importedAt,
  }

  const validationFlow = { ...draft, sessionId: "dify-import-validation" }
  const structural = validateFlow(validationFlow)
  for (const issue of structural.issues) {
    issues.push({
      code: `TARGET_${issue.code}`,
      level: "error",
      message: issue.message,
      ...(issue.id ? { nodeId: issue.id } : {}),
    })
  }
  for (const issue of checkGraphInvariants({ flow: validationFlow, origin: "user" })) {
    issues.push({
      code: `TARGET_${issue.code}`,
      level: issue.level,
      message: issue.message,
      ...(issue.nodeIds?.[0] ? { nodeId: issue.nodeIds[0] } : {}),
    })
  }

  const deduplicated = deduplicateIssues(issues)
  const report: WorkflowImportMetadata = {
    platform: "dify",
    ...(source.source.dslVersion ? { sourceVersion: source.source.dslVersion } : {}),
    importedAt,
    status: statusOf(deduplicated),
    issues: deduplicated,
    dependencies: source.dependencies.map(convertDependency),
  }
  draft.sourceImport = report
  return { template: draft, report }
}

function convertNode(node: SourceNodeIR, index: number, issues: WorkflowImportIssue[]): GraphNode {
  const position = positionOf(node, index)
  if (node.semanticKind === "start" || node.semanticKind === "end") {
    return {
      id: node.id,
      kind: node.semanticKind,
      position,
      data: { label: stageLabel(node.semanticKind, "mode1") },
    }
  }

  const model = recordOf(node.config.model)
  const provider = stringOf(model?.provider) ?? ""
  const modelName = stringOf(model?.name) ?? ""
  if ((node.semanticKind === "llm" || node.semanticKind === "agent") && (!provider || !modelName)) {
    issues.push(issueOf(node, "DIFY_MODEL_REBIND_REQUIRED", "warning", "该节点缺少可直接使用的模型映射，请在运行前重新选择模型。"))
  }
  if (!directlyMappedKinds.has(node.semanticKind)) {
    const blocked = blockingKinds.has(node.semanticKind)
    issues.push(issueOf(
      node,
      blocked ? "DIFY_NODE_UNSUPPORTED" : "DIFY_NODE_REVIEW_REQUIRED",
      blocked ? "error" : "warning",
      blocked
        ? "该 Dify 节点没有等价的原生执行语义，已保留为占位 Agent；完成适配前不能直接运行。"
        : "该 Dify 节点已保留为占位 Agent，请重绑定对应能力并核对执行语义。",
    ))
  }

  const role: RoleNode = {
    id: node.id,
    kind: "agent",
    position,
    data: {
      label: node.title?.trim() || node.source.type || node.id,
      responsibility: {
        id: `dify:${node.id}`,
        purpose: responsibilityOf(node),
        deliverable: "产生与原 Dify 节点等价的输出，并交给下游节点。",
      },
      systemPrompt: promptOf(node),
      provider,
      model: modelName,
      presetId: null,
      retryLimit: 3,
      reactLimit: null,
      inputSchema: JSON.stringify(node.inputs, null, 2),
      outputSchema: JSON.stringify(node.outputs, null, 2),
      injectSystemPrompt: true,
      injectToolSections: true,
      groupId: null,
    },
  }
  return role
}

function convertEdge(edge: SourceEdgeIR): Line {
  const condition = conditionOf(edge.sourceHandle)
  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    sourceHandle: "flow-out",
    targetHandle: "flow-in",
    ...(condition ? { condition } : {}),
  }
}

function collectSourceIssues(
  source: SourceWorkflowIR,
  capabilities: DifyCapabilities,
  issues: WorkflowImportIssue[],
): void {
  if (capabilities.hasEnvironmentVariables || capabilities.hasConversationVariables) {
    issues.push({
      code: "DIFY_VARIABLE_SCOPE_REVIEW_REQUIRED",
      level: "warning",
      message: "Dify 环境变量或会话变量不会携带值，需在目标环境重新绑定。",
    })
  }
  if (source.variables.length > 0) {
    const names = [...new Set(source.variables.map((variable) => variable.name))]
    issues.push({
      code: "DIFY_VARIABLE_BINDING_REQUIRED",
      level: "warning",
      message: `Dify 变量不会自动获得运行时值，请核对并绑定：${names.join("、")}。`,
    })
  }
  for (const dependency of source.dependencies) {
    if (dependency.kind === "model") {
      issues.push({
        code: "DIFY_MODEL_REBIND_REQUIRED",
        level: "warning",
        message: `尚未验证目标环境是否提供模型「${dependency.source.name ?? dependency.id}」，请在运行前确认或重新选择。`,
        nodeId: dependency.id.split(":", 1)[0],
      })
      continue
    }
    issues.push({
      code: `DIFY_${dependency.kind.toUpperCase()}_REBIND_REQUIRED`,
      level: dependency.kind === "credential" ? "error" : "warning",
      message: dependencyMessage(dependency),
      nodeId: dependency.id.split(":", 1)[0],
    })
  }
  for (const field of capabilities.unknownFields) {
    issues.push({
      code: "DIFY_UNKNOWN_ROOT_FIELD",
      level: "warning",
      message: `Dify 导出包含当前适配器不认识的顶层字段：${field}。`,
    })
  }
}

function promptOf(node: SourceNodeIR): string {
  const prompt = node.config.prompt_template
  const sections: string[] = []
  if (Array.isArray(prompt)) {
    for (const item of prompt) {
      const entry = recordOf(item)
      const text = stringOf(entry?.text)?.trim()
      if (text) sections.push(`${stringOf(entry?.role) ?? "prompt"}:\n${text}`)
    }
  }
  if (sections.length > 0 && (node.semanticKind === "llm" || node.semanticKind === "agent")) {
    return sections.join("\n\n")
  }
  return [
    `这是从 Dify 的 ${node.source.type} 节点导入的适配占位。`,
    "请先根据兼容报告重绑定所需模型、工具、知识库或凭据，再确认执行语义。",
    "来源配置已脱敏：",
    limitedJson(node.config),
  ].join("\n\n")
}

function responsibilityOf(node: SourceNodeIR): string {
  if (node.semanticKind === "llm" || node.semanticKind === "agent") return `执行原 Dify「${node.title ?? node.id}」节点的模型任务。`
  return `承接原 Dify ${node.source.type} 节点的职责；当前为待适配占位。`
}

function positionOf(node: SourceNodeIR, index: number): { x: number; y: number } {
  const raw = recordOf(node.source.raw)
  const original = recordOf(raw?.position)
  const x = numberOf(original?.x)
  const y = numberOf(original?.y)
  if (x !== undefined && y !== undefined) return { x, y }
  return { x: 120 + index * 280, y: 120 }
}

function conditionOf(sourceHandle: string | undefined): Line["condition"] | undefined {
  const normalized = sourceHandle?.trim().toLowerCase()
  if (!normalized || normalized === "source") return undefined
  if (["true", "yes", "pass"].includes(normalized)) return { type: "pass" }
  if (["false", "no", "fail"].includes(normalized)) return { type: "fail" }
  return { type: "content", label: sourceHandle }
}

function issueOf(
  node: SourceNodeIR,
  code: string,
  level: WorkflowImportIssue["level"],
  message: string,
): WorkflowImportIssue {
  return { code, level, message, nodeId: node.id, sourceType: node.source.type }
}

function convertDependency(dependency: SourceDependencyIR): WorkflowImportDependency {
  return {
    kind: dependency.kind,
    ...(dependency.source.provider ? { provider: dependency.source.provider } : {}),
    ...(dependency.source.name ? { name: dependency.source.name } : {}),
    requiresRebinding: true,
  }
}

function dependencyMessage(dependency: SourceDependencyIR): string {
  const label = dependency.source.name ?? dependency.source.provider ?? dependency.id
  if (dependency.kind === "credential") return `来源凭据「${label}」已被移除，必须在目标环境重新配置。`
  return `外部依赖「${label}」不会自动迁移，请在目标环境重新绑定 ${dependency.kind}。`
}

function statusOf(issues: readonly WorkflowImportIssue[]): WorkflowImportStatus {
  if (issues.some((issue) => issue.level === "error")) return "blocked"
  if (issues.length > 0) return "review-required"
  return "ready"
}

function deduplicateIssues(issues: readonly WorkflowImportIssue[]): WorkflowImportIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.code}|${issue.nodeId ?? ""}|${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function limitedJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2)
  return text.length <= 12_000 ? text : `${text.slice(0, 12_000)}\n…（配置过长，已截断）`
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
