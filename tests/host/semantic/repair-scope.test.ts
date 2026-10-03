import { describe, expect, it } from "vitest"
import { repairModeFor, semanticIssueFingerprint, SemanticPlanningService, SemanticReviewer, validateSemanticRepairScope } from "../../../src/host/semantic/index.js"
import type { SemanticFailureState, SemanticIssue } from "../../../src/host/semantic/index.js"
import type { WorkflowDocument } from "../../../src/host/shared/graph-model.js"

function doc(): WorkflowDocument {
  return {
    id: "f", mode: "mode1", name: "f", revision: 0,
    nodes: [
      { id: "a", kind: "start", position: { x: 0, y: 0 }, data: { label: "start" } },
      { id: "b", kind: "pause", position: { x: 1, y: 0 }, data: { label: "affected" } },
      { id: "c", kind: "end", position: { x: 2, y: 0 }, data: { label: "end" } },
    ],
    lines: [
      { id: "1", source: "a", sourceHandle: "flow-out", target: "b", targetHandle: "flow-in" },
      { id: "2", source: "b", sourceHandle: "flow-out", target: "c", targetHandle: "flow-in" },
    ],
  } as WorkflowDocument
}

const issue: SemanticIssue = { type: "requirement_partially_covered", level: "error", requirementIds: ["R1"], affectedNodeIds: ["b"], reason: "r", evidence: "e", repairGuidance: "g" }

function failure(overrides: Partial<SemanticFailureState> = {}): SemanticFailureState {
  return { candidate: doc(), issues: [issue], fingerprint: semanticIssueFingerprint([issue]), repeatCount: 1, affectedNodeIds: ["b"], repairMode: "local", ...overrides }
}

describe("semantic repair scope", () => {
  it("只改 affected node 通过，同时改 unrelated node 被拒绝", () => {
    const local = doc()
    ;(local.nodes[1].data as { label: string }).label = "repaired"
    expect(validateSemanticRepairScope(failure(), local)).toBeNull()
    ;(local.nodes[2].data as { label: string }).label = "unrelated"
    expect(validateSemanticRepairScope(failure(), local)?.changedOutsideScope).toContain("c")
  })

  it("line id 改变但语义不变不误判", () => {
    const next = doc()
    next.lines[0].id = "new-random-id"
    expect(validateSemanticRepairScope(failure(), next)).toBeNull()
  })

  it("相同 fingerprint 按 local、subgraph、boundary_replan 升级，文本变化不影响指纹", () => {
    expect([1, 2, 3, 4].map(repairModeFor)).toEqual(["local", "subgraph", "boundary_replan", "boundary_replan"])
    expect(semanticIssueFingerprint([{ ...issue, reason: "换一种说法" }])).toBe(semanticIssueFingerprint([issue]))
    expect(semanticIssueFingerprint([{ ...issue, requirementIds: ["R2"] }])).not.toBe(semanticIssueFingerprint([issue]))
  })

  it("subgraph 允许一跳 flow 邻居，local 不允许", () => {
    const next = doc()
    ;(next.nodes[0].data as { label: string }).label = "neighbor"
    expect(validateSemanticRepairScope(failure(), next)?.changedOutsideScope).toContain("a")
    expect(validateSemanticRepairScope(failure({ repairMode: "subgraph", repeatCount: 2 }), next)).toBeNull()
  })

  it("uncovered 可新增 owner 和直连边，但不能改已有无关节点", () => {
    const uncovered = { ...issue, type: "requirement_uncovered" as const, affectedNodeIds: [] }
    const next = doc()
    next.nodes.push({ id: "owner", kind: "pause", position: { x: 3, y: 0 }, data: { label: "owner" } })
    next.lines.push({ id: "3", source: "b", sourceHandle: "flow-out", target: "owner", targetHandle: "flow-in" })
    const state = failure({ issues: [uncovered], affectedNodeIds: [] })
    expect(validateSemanticRepairScope(state, next)).toBeNull()
    ;(next.nodes[0].data as { label: string }).label = "rewritten"
    expect(validateSemanticRepairScope(state, next)?.changedOutsideScope).toContain("a")
  })

  it("新 /arrange 替换当前 context；相同失败升级，fingerprint 变化重置", () => {
    const service = new SemanticPlanningService(new SemanticReviewer({}))
    service.recordArrangeIntent("session", "plan-1", "旧需求")
    service.recordArrangeIntent("session", "plan-2", "新需求")
    expect(service.getPlanningContext("session")).toMatchObject({ planningId: "plan-2", originalUserIntent: "新需求" })
    expect(service.recordFailure("session", "plan-2", doc(), [issue]).repairMode).toBe("local")
    expect(service.recordFailure("session", "plan-2", doc(), [{ ...issue, reason: "换说法" }]).repairMode).toBe("subgraph")
    expect(service.recordFailure("session", "plan-2", doc(), [{ ...issue, evidence: "换证据" }]).repairMode).toBe("boundary_replan")
    expect(service.recordFailure("session", "plan-2", doc(), [{ ...issue, requirementIds: ["R2"] }]).repeatCount).toBe(1)
  })
})
