import { afterEach, expect, it } from "vitest"
import { agent, caller, cleanupTempDirs, groupNode, makeFlow, makeHarness, parentNode, stage, start } from "./fixtures/harness.js"
import type { WorkflowDocument } from "../../../src/host/shared/graph-model.js"

afterEach(cleanupTempDirs)
function groupFlow(): WorkflowDocument {
  return { ...makeFlow(), nodes: [stage("n-start", "start"), groupNode("group", "team", ["first", "second"]), agent("first", "first", { groupId: "group" }), agent("second", "second", { groupId: "group" }), stage("n-end", "end"), { id: "proxy-first", kind: "proxy", proxySourceId: "first", position: { x: 0, y: 0 } }], lines: [{ id: "entry", source: "n-start", target: "group", sourceHandle: "flow-out", targetHandle: "flow-in" }, { id: "exit", source: "group", target: "n-end", sourceHandle: "flow-out", targetHandle: "flow-in" }] }
}

it("test_group_all_members_preflight_before_any_child_or_budget_is_spent", async () => {
  const h = await makeHarness()
  h.runner.teamEnabled = true
  const flow = groupFlow()
  const node = flow.nodes.find((node) => node.id === "second")!
  if (node.kind === "agent") node.data.execution = { inputs: { missing: { kind: "json" } } }
  const { entry } = await start(h, flow)
  await expect(h.runtime.wfRunNode(caller, { nodeId: "group" })).rejects.toMatchObject({ code: "WF_INPUT_REQUIRED" })
  expect(h.runner.groupCalls).toEqual([])
  expect(entry.callCount).toBe(0)
  expect(entry.snapshot.nodes.filter((node) => ["group", "first", "second"].includes(node.nodeId)).map((node) => [node.status, node.attempts])).toEqual([["pending", 0], ["pending", 0], ["pending", 0]])
})

it("test_group_reservation_blocks_main_proxy_and_second_group_dispatch", async () => {
  const h = await makeHarness()
  h.runner.teamEnabled = true
  let entered!: () => void
  let release!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const startGroup = h.runner.startGroupTask.bind(h.runner)
  h.runner.startGroupTask = async (input) => { entered(); await gate; return startGroup(input) }
  const { entry } = await start(h, groupFlow())
  const first = h.runtime.wfRunNode(caller, { nodeId: "group" })
  await ready
  for (const id of ["first", "proxy-first", "group"]) await expect(h.runtime.wfRunNode(caller, { nodeId: id })).rejects.toMatchObject({ code: "WF_BUSY" })
  release()
  await first
  expect(h.runner.calls).toEqual([])
  expect(h.runner.groupCalls).toHaveLength(1)
  expect(entry.snapshot.nodes.find((node) => node.nodeId === "first")?.attempts).toBe(1)
  await expect(h.runtime.wfRunNode(caller, { nodeId: "proxy-first" })).rejects.toMatchObject({ code: "WF_BUSY" })
})

it("test_hybrid_parent_preflight_missing_input_does_not_leak_run_lock", async () => {
  const h = await makeHarness()
  const parent = parentNode("parent", "executor")
  parent.data.execution = { inputs: { subject: { kind: "text" } } }
  const flow = { ...makeFlow(), nodes: [stage("n-start", "start"), parent, stage("n-end", "end")], lines: [{ id: "entry", source: "n-start", target: "parent", sourceHandle: "flow-out" as const, targetHandle: "flow-in" as const }, { id: "exit", source: "parent", target: "n-end", sourceHandle: "flow-out" as const, targetHandle: "flow-in" as const }] }
  await h.store.saveWorkflow(flow, "session-1", { force: true })
  await expect(h.runtime.startRun({ sessionId: "session-1", flowId: flow.id })).rejects.toMatchObject({ code: "WF_INPUT_REQUIRED" })
  expect(h.runtime.flowLockInfo(flow.id)).toBeNull()
  expect(h.agents.roots.get("session-1")?.messages).toEqual([])
})

it("test_hybrid_parent_invalid_json_contract_does_not_complete_run", async () => {
  const h = await makeHarness()
  const parent = parentNode("parent", "executor")
  parent.data.execution = { outputs: { data: { kind: "json", schema: { type: "object", required: ["total"] } } } }
  const flow: WorkflowDocument = { ...makeFlow(), nodes: [stage("n-start", "start"), parent, stage("n-end", "end")], lines: [{ id: "entry", source: "n-start", target: "parent", sourceHandle: "flow-out", targetHandle: "flow-in" }, { id: "exit", source: "parent", target: "n-end", sourceHandle: "flow-out", targetHandle: "flow-in" }] }
  const { entry } = await start(h, flow)
  await expect(h.runtime.wfFinish(caller, {})).rejects.toMatchObject({ code: "WF_OUTPUT_INVALID" })
  expect(entry.snapshot.nodes.find((node) => node.nodeId === parent.id)).toMatchObject({ status: "fail", result: { status: "failed", outputs: {} } })
  await h.runtime.wfFinish(caller, { status: "failed" })
  expect(h.runtime.flowLockInfo(flow.id)).toBeNull()
})
