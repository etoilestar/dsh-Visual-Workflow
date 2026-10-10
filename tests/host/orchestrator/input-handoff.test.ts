import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { effectiveNodeInputs, workflowInputTarget } from "../../../src/host/orchestrator/input-handoff.js"
import type { WorkflowDocument, RoleNode } from "../../../src/host/shared/graph-model.js"
import { caller, cleanupTempDirs, makeFlow, makeHarness } from "./fixtures/harness.js"
afterEach(cleanupTempDirs)
function serial(): WorkflowDocument {
  const flow = makeFlow()
  flow.nodes = flow.nodes.filter((node) => node.kind !== "pause")
  flow.lines = [{ id: "in", source: "n-start", target: "n-a1", sourceHandle: "flow-out", targetHandle: "flow-in" }, { id: "next", source: "n-a1", target: "n-a2", sourceHandle: "flow-out", targetHandle: "flow-in" }, { id: "out", source: "n-a2", target: "n-end", sourceHandle: "flow-out", targetHandle: "flow-in" }]
  return flow
}

it("test_workflow_input_multiple_initial_agents_requires_explicit_target", () => {
  const flow = serial()
  expect(workflowInputTarget(flow)).toBe("n-a1")
  flow.lines = flow.lines.filter((line) => line.id !== "next")
  expect(() => workflowInputTarget(flow)).toThrowError(expect.objectContaining({ code: "WF_INPUT_AMBIGUOUS" }))
})

it.each(["multiple", "condition", "cycle", "group"])("test_auto_%s_graph_requires_explicit_input_without_guessing", async (kind) => {
  const h = await makeHarness()
  const flow = serial()
  const target = flow.nodes.find((node) => node.id === "n-a2") as RoleNode
  if (kind === "multiple") flow.lines.push({ id: "other", source: "n-start", target: "n-a2", sourceHandle: "flow-out", targetHandle: "flow-in" })
  if (kind === "condition") flow.lines[1].condition = { type: "pass" }
  if (kind === "cycle") flow.lines.push({ id: "back", source: "n-a2", target: "n-a1", sourceHandle: "flow-out", targetHandle: "flow-in" })
  if (kind === "group") target.data.groupId = "group"
  const snapshot = { id: "run", handoffPolicy: "auto", nodes: [] } as unknown as import("../../../src/host/shared/types.js").RunSnapshot
  await expect(effectiveNodeInputs(flow, target, snapshot)).rejects.toMatchObject({ code: "WF_INPUT_AMBIGUOUS" })
  expect(h.runner.calls).toEqual([])
})

it("test_explicit_policy_and_ctx_keep_original_context_priority", async () => {
  const flow = serial()
  const node = flow.nodes.find((node) => node.id === "n-a2") as RoleNode
  const snapshot = { id: "run", handoffPolicy: "explicit", nodes: [] } as unknown as import("../../../src/host/shared/types.js").RunSnapshot
  expect(await effectiveNodeInputs(flow, node, snapshot)).toEqual({})
  snapshot.handoffPolicy = "auto"
  flow.lines.push({ id: "ctx", source: "n-a1", target: "n-a2", sourceHandle: "ctx-out", targetHandle: "ctx-in" })
  expect(await effectiveNodeInputs(flow, node, snapshot)).toEqual({})
})

it("test_auto_settled_file_modified_after_settlement_is_rejected", async () => {
  const h = await makeHarness(undefined, { workingDirectory: async () => h.dir })
  const flow = serial()
  const first = flow.nodes.find((node) => node.id === "n-a1") as RoleNode
  first.data.execution = { outputFiles: ["artifact.json"] }
  await h.store.saveWorkflow(flow, "session-1")
  await h.runtime.startRun({ sessionId: "session-1", flowId: flow.id, handoffPolicy: "auto" })
  await h.runtime.wfRunNode(caller, { nodeId: first.id })
  await writeFile(join(h.dir, "artifact.json"), "valid-at-settlement")
  await h.runtime.handleSubagentEnd({ id: "child-1", stopReason: "completed" })
  await writeFile(join(h.dir, "artifact.json"), "changed-after-settlement")
  await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a2" })).rejects.toMatchObject({ code: "WF_OUTPUT_FILE_STALE" })
  expect(h.runner.calls).toHaveLength(1)
})
