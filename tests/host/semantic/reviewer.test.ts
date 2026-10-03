import { describe, expect, it } from "vitest"
import { buildSemanticWorkflowView, SemanticReviewer, SEMANTIC_REVIEWER_PROMPT } from "../../../src/host/semantic/index.js"
import type { WorkflowDocument } from "../../../src/host/shared/graph-model.js"

function flow(): WorkflowDocument {
  return {
    id: "flow", mode: "mode1", name: "flow", revision: 0,
    nodes: [
      { id: "a", kind: "agent", position: { x: 20, y: 30 }, data: { label: "检索", systemPrompt: "检索原始资料", outputSchema: "原始检索结果", provider: "p", model: "m", retryLimit: 1 } },
      { id: "b", kind: "agent", position: { x: 40, y: 30 }, data: { label: "分析", systemPrompt: "分析筛选后的证据", provider: "p", model: "m", retryLimit: 1 } },
    ],
    lines: [{ id: "line-random", source: "a", sourceHandle: "flow-out", target: "b", targetHandle: "flow-in" }],
  } as WorkflowDocument
}

async function* chunks(...values: unknown[]): AsyncIterable<unknown> {
  for (const value of values) yield value
}

function response(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    passed: true,
    requirements: [{ id: "R1", text: "检索", ownerNodeIds: ["a"] }],
    issues: [],
    ...overrides,
  })
}

describe("SemanticReviewer", () => {
  it("输入只含原始需求与职责投影，且普通 flow 明确不作为数据交接", async () => {
    const calls: Array<Record<string, unknown>> = []
    const reviewer = new SemanticReviewer({
      agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "m" }) },
      llm: { stream: (input) => { calls.push(input); return chunks(response()) } },
    })
    const result = await reviewer.review("检索资料", flow())
    expect(result.result?.passed).toBe(true)
    const user = ((calls[0].messages as Array<{ content: string }>)[1].content)
    const payload = JSON.parse(user) as Record<string, unknown>
    expect(Object.keys(payload)).toEqual(["originalUserIntent", "workflow"])
    expect(user).not.toContain("position")
    expect(user).not.toContain("provider")
    expect(buildSemanticWorkflowView(flow()).lines[0].channel).toBe("flow")
    expect(SEMANTIC_REVIEWER_PROMPT).toContain("所有 requirement 只能来自 originalUserIntent")
    expect(SEMANTIC_REVIEWER_PROMPT).toContain("普通 flow 线只代表顺序")
  })

  it("接受缺失需求、责任重叠与 ctx 语义错配的严格协议", async () => {
    const candidate = flow()
    candidate.lines[0] = { ...candidate.lines[0], sourceHandle: "ctx-out", targetHandle: "ctx-in" }
    const json = response({
      passed: false,
      requirements: [
        { id: "R1", text: "检索", ownerNodeIds: ["a"] },
        { id: "R2", text: "筛选", ownerNodeIds: [] },
      ],
      issues: [
        { type: "requirement_uncovered", level: "error", requirementIds: ["R2"], affectedNodeIds: [], reason: "没有 owner", evidence: "节点中无筛选", repairGuidance: "新增筛选 owner" },
        { type: "dataflow_semantic_mismatch", level: "error", requirementIds: ["R1"], affectedNodeIds: ["a", "b"], reason: "原始结果不是筛选证据", evidence: "outputSchema 与输入假设冲突", repairGuidance: "修正交接" },
        { type: "responsibility_overlap", level: "warning", requirementIds: ["R1"], affectedNodeIds: ["a", "b"], reason: "核心职责重复", evidence: "均执行统计", repairGuidance: "收窄边界" },
      ],
    })
    const reviewer = new SemanticReviewer({
      agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "m" }) },
      llm: { stream: () => chunks(json) },
    })
    const result = await reviewer.review("检索、筛选并分析", candidate)
    expect(result.result?.issues.map((issue) => issue.type)).toEqual([
      "requirement_uncovered", "dataflow_semantic_mismatch", "responsibility_overlap",
    ])
    expect(buildSemanticWorkflowView(candidate).lines[0].channel).toBe("ctx")
  })

  it("非法 JSON 只重试一次，第二次失败显式 unavailable", async () => {
    let calls = 0
    const logs: string[] = []
    const reviewer = new SemanticReviewer({
      agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "m" }) },
      llm: { stream: () => { calls += 1; return chunks("not-json") } },
      logger: { error: (message) => logs.push(message) },
    })
    const result = await reviewer.review("需求", flow())
    expect(calls).toBe(2)
    expect(result.available).toBe(false)
    expect(logs[0]).toContain("semantic review unavailable")
  })

  it("LLM service 缺失时显式 unavailable 且不调用模型", async () => {
    const logs: string[] = []
    const result = await new SemanticReviewer({ logger: { error: (message) => logs.push(message) } }).review("需求", flow())
    expect(result).toEqual({ available: false, unavailableReason: "LLM 或默认模型服务不可用" })
    expect(logs).toHaveLength(1)
  })
})
