import { describe, expect, it } from "vitest"

import { registerArrangeCommand, type ArrangeInjectedMessage } from "../../../src/host/commands/arrange.js"
import { PlanningService } from "../../../src/host/planning/index.js"
import { executeGraphPatch, type GraphPatchHost } from "../../../src/host/tools/wf-graph-patch/tool.js"

function arrangeHarness(service: PlanningService) {
  let handler: ((invocation: unknown) => unknown) | undefined
  const messages: ArrangeInjectedMessage[] = []
  registerArrangeCommand({
    get: () => ({ register: (definition: { handler: (invocation: unknown) => unknown }) => {
      handler = definition.handler
      return () => {}
    } }),
  }, {
    newPlanningId: () => "planning-1",
    newMessageId: () => "message-1",
    recordPlanningIntent: (input) => { service.record(input) },
  })
  handler?.({
    agent: { id: "session-1", followup: (message: ArrangeInjectedMessage) => messages.push(message) },
    rawInput: "  保留两侧空格的需求  ",
  })
  return messages
}

const graphHost = (getPlanningContext?: GraphPatchHost["getPlanningContext"]): GraphPatchHost => ({
  getPlanningContext,
} as GraphPatchHost)

describe("PlanningContext", () => {
  it("test_arrange_records_generated_id_bound_session_and_original_intent", () => {
    const service = new PlanningService(() => 123)
    const messages = arrangeHarness(service)

    expect(service.getPlanningContext("session-1")).toEqual({
      planningId: "planning-1",
      sessionId: "session-1",
      originalUserIntent: "  保留两侧空格的需求  ",
      createdAt: 123,
    })
    expect(service.getPlanningContext("session-2")).toBeUndefined()
    expect(messages[0].content[0].text).toContain("本次规划任务 ID：\nplanning-1")
  })

  it("test_record_duplicate_planning_id_rejected", () => {
    const service = new PlanningService()
    service.record({ planningId: "planning-1", sessionId: "session-1", originalUserIntent: "需求" })
    expect(() => service.record({ planningId: "planning-1", sessionId: "session-2", originalUserIntent: "其他" }))
      .toThrow("planningId 已存在")
  })

  it("test_graph_patch_valid_planning_id_passes_tracking_validation", async () => {
    const host = graphHost(() => ({ planningId: "planning-1", sessionId: "session-1" }))
    await expect(executeGraphPatch(host, "session-1", { planningId: "planning-1" }))
      .rejects.toMatchObject({ code: "WF_SCOPE_INVALID" })
  })

  it("test_graph_patch_wrong_planning_id_returns_bad_args", async () => {
    const host = graphHost(() => ({ planningId: "planning-1", sessionId: "session-1" }))
    await expect(executeGraphPatch(host, "session-1", { planningId: "wrong" }))
      .rejects.toMatchObject({ code: "WF_BAD_ARGS" })
  })

  it("test_graph_patch_without_planning_id_remains_compatible", async () => {
    await expect(executeGraphPatch(graphHost(), "session-1", {}))
      .rejects.toMatchObject({ code: "WF_SCOPE_INVALID" })
  })
})
