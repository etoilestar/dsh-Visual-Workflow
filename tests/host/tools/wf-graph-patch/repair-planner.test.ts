import { describe, expect, it } from "vitest"
import { planResponsibilityRepair } from "../../../../src/host/tools/wf-graph-patch/repair-planner.js"
import type { GraphNode, WorkflowDocument, WorkflowValidationWarning } from "../../../../src/host/shared/graph-model.js"

function agent(id: string, responsibilityId: string): GraphNode {
  return {
    id,
    kind: "agent",
    position: { x: 0, y: 0 },
    data: {
      label: id, systemPrompt: "", provider: "", model: "", retryLimit: 3,
      responsibility: { id: responsibilityId, purpose: id },
    },
  }
}

function workflow(): WorkflowDocument {
  return {
    id: "flow", sessionId: "session", mode: "mode1", name: "review", description: "",
    nodes: [agent("search", "R1"), agent("screen", "R2"), agent("write", "R3"), agent("report", "R4")],
    lines: [
      { id: "l1", source: "search", target: "screen", sourceHandle: "flow-out", targetHandle: "flow-in" },
      { id: "l2", source: "screen", target: "write", sourceHandle: "flow-out", targetHandle: "flow-in" },
      { id: "l3", source: "write", target: "report", sourceHandle: "flow-out", targetHandle: "flow-in" },
    ],
  }
}

const warning: WorkflowValidationWarning = {
  code: "responsibilityDeliverableMissing",
  message: "缺少明确产出",
  nodeIds: ["write"],
  responsibilityIds: ["R3"],
  suggestion: "补充产出",
}

describe("planResponsibilityRepair", () => {
  it("small：只提议 update_node_data 并保留所有无关节点与连线", () => {
    const proposal = planResponsibilityRepair({
      workflow: workflow(), warning, targetResponsibilityId: "R3",
      change: { kind: "update_node", data: { responsibility: { id: "R3", purpose: "撰写综述", deliverable: "综述初稿" } } },
    })
    expect(proposal).toMatchObject({ scope: "small", targetNodeId: "write", requiresConfirmation: true })
    expect(proposal?.ops).toEqual([{ op: "update_node_data", nodeId: "write", data: { responsibility: { id: "R3", purpose: "撰写综述", deliverable: "综述初稿" } } }])
    expect(proposal?.preservedNodeIds).toEqual(["search", "screen", "report"])
    expect(proposal?.preservedLineIds).toEqual(["l1", "l2", "l3"])
  })

  it("medium：在目标相邻 flow edge 中插入缺失节点，不重建其余图", () => {
    const proposal = planResponsibilityRepair({
      workflow: workflow(), warning, targetResponsibilityId: "R3",
      change: { kind: "insert_node", replaceLineId: "l2", node: { id: "analysis", kind: "agent", data: { label: "统计分析" } } },
    })
    expect(proposal?.scope).toBe("medium")
    expect(proposal?.ops.map((op) => op.op)).toEqual(["create_node", "disconnect", "connect", "connect"])
    expect(proposal?.preservedNodeIds).toEqual(["search", "screen", "report"])
    expect(proposal?.preservedLineIds).toEqual(["l1", "l3"])
  })

  it("large：只允许调整目标直接邻域内的既有 edge", () => {
    const local = planResponsibilityRepair({
      workflow: workflow(), warning, targetResponsibilityId: "R3",
      change: { kind: "adjust_edges", disconnectLineIds: ["l3"], connections: [{ op: "connect", source: "screen", target: "report" }] },
    })
    expect(local?.scope).toBe("large")
    const unrelated = planResponsibilityRepair({
      workflow: workflow(), warning, targetResponsibilityId: "R3",
      change: { kind: "adjust_edges", disconnectLineIds: ["l1"], connections: [] },
    })
    expect(unrelated).toBeNull()
  })

  it("责任 id 不唯一时不生成 proposal", () => {
    const flow = workflow()
    const report = flow.nodes.find((node) => node.id === "report")
    if (report?.kind === "agent") report.data.responsibility = { id: "R3", purpose: "报告" }
    expect(planResponsibilityRepair({
      workflow: flow, warning, targetResponsibilityId: "R3",
      change: { kind: "update_node", data: { label: "new" } },
    })).toBeNull()
  })
})
