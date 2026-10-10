import { afterEach, expect, it } from "vitest"
import { sweepWatchdogOnce } from "../../../src/host/orchestrator/watchdog.js"
import { caller, cleanupTempDirs, makeFlow, makeHarness, parentNode, stage, start } from "./fixtures/harness.js"

afterEach(cleanupTempDirs)

it.each(["bash", "glob", "send_message", "write"])("test_pure_coordinator_%s_is_denied_and_parent_calls_recorded", async (name) => {
  const h = await makeHarness()
  const { entry } = await start(h, makeFlow())
  await expect(h.runtime.authorizeParentTool(caller, name, {})).rejects.toMatchObject({ code: "WF_PARENT_TOOL_DENIED" })
  expect(entry.snapshot.usage).toMatchObject({ parentCalls: 1, nodeExecutions: 0, tokenAccounting: "unavailable" })
  expect(h.runner.calls).toEqual([])
})

it("test_pure_coordinator_read_and_graph_patch_cannot_bind_business_inputs", async () => {
  const h = await makeHarness()
  const { entry } = await start(h, makeFlow())
  await h.runtime.authorizeParentTool(caller, "read", { path: h.store.orchestrationFilePath(entry.snapshot.id) })
  await expect(h.runtime.authorizeParentTool(caller, "read", { path: "/workspace/business.txt" })).rejects.toMatchObject({ code: "WF_PARENT_TOOL_DENIED" })
  await expect(h.runtime.authorizeParentTool(caller, "wf_graph_patch", { ops: [{ op: "update_node_data", nodeId: "n-a1", data: { systemPrompt: "temporary input" } }] })).rejects.toMatchObject({ code: "WF_PARENT_TOOL_DENIED" })
  await expect(h.runtime.authorizeParentTool(caller, "wf_graph_patch", { ops: [{ op: "create_node", node: { kind: "file", data: { managedPath: "/guessed/input.csv" } } }] })).rejects.toMatchObject({ code: "WF_PARENT_TOOL_DENIED" })
  await h.runtime.authorizeParentTool(caller, "wf_graph_patch", { ops: [{ op: "update_node_data", nodeId: "n-a1", data: { label: "new label" } }] })
})

it("test_hybrid_parent_retains_native_business_tools", async () => {
  const h = await makeHarness()
  const parent = parentNode("parent", "executor")
  const flow = { ...makeFlow(), nodes: [stage("n-start", "start"), parent, stage("n-end", "end")], lines: [{ id: "entry", source: "n-start", target: "parent", sourceHandle: "flow-out" as const, targetHandle: "flow-in" as const }, { id: "exit", source: "parent", target: "n-end", sourceHandle: "flow-out" as const, targetHandle: "flow-in" as const }] }
  await start(h, flow)
  await expect(h.runtime.authorizeParentTool(caller, "bash", { command: "business" })).resolves.toBeUndefined()
})

it("test_parent_call_budget_cancels_root_and_releases_lock", async () => {
  const h = await makeHarness()
  const flow = makeFlow()
  flow.runtime = { version: 1, budget: { parentCallLimit: 1 } }
  const { entry } = await start(h, flow)
  await h.runtime.authorizeParentTool(caller, "wf_org_catalog", {})
  await expect(h.runtime.authorizeParentTool(caller, "wf_org_catalog", {})).rejects.toMatchObject({ code: "WF_PARENT_CALL_LIMIT" })
  expect(h.agents.cancellations).toEqual([{ sessionId: "session-1", reason: "WF_PARENT_CALL_LIMIT" }])
  expect(h.runtime.flowLockInfo(flow.id)).toBeNull()
  expect((await h.store.getRun(entry.snapshot.id))?.usage).toMatchObject({ parentCalls: 2, nodeExecutions: 0 })
})

it("test_node_execution_budget_is_independent_and_stops_before_next_child", async () => {
  const h = await makeHarness()
  const flow = makeFlow()
  flow.runtime = { version: 1, budget: { nodeExecutionLimit: 1 } }
  const { entry } = await start(h, flow)
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  await h.runtime.handleSubagentEnd({ id: "child-1", stopReason: "completed" })
  await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a2" })).rejects.toMatchObject({ code: "WF_NODE_EXECUTION_LIMIT" })
  expect(h.runner.calls).toHaveLength(1)
  expect(entry.snapshot.usage).toMatchObject({ nodeExecutions: 1, parentCalls: 0 })
  expect(h.runtime.flowLockInfo(flow.id)).toBeNull()
})

it("test_repeated_failure_budget_terminates_without_model_finish", async () => {
  const h = await makeHarness()
  const flow = makeFlow()
  flow.runtime = { version: 1, budget: { repeatedFailureLimit: 2 } }
  const { entry } = await start(h, flow)
  const error = { code: "WF_BAD_ARGS", message: "nodeId: required" }
  await h.runtime.recordParentToolResult(caller, "wf_run_node", error)
  await expect(h.runtime.recordParentToolResult(caller, "wf_run_node", error)).rejects.toMatchObject({ code: "WF_REPEATED_FAILURE" })
  expect(entry.snapshot.parentFailures?.map((failure) => failure.code)).toEqual(["WF_BAD_ARGS", "WF_BAD_ARGS"])
  expect(entry.snapshot.termination?.failure?.code).toBe("WF_REPEATED_FAILURE")
  expect(h.runtime.flowLockInfo(flow.id)).toBeNull()
})

it("test_successful_tool_result_resets_consecutive_failure_budget", async () => {
  const h = await makeHarness()
  const flow = makeFlow()
  flow.runtime = { version: 1, budget: { repeatedFailureLimit: 2 } }
  const { entry } = await start(h, flow)
  await h.runtime.recordParentToolResult(caller, "wf_run_node", { code: "WF_BAD_ARGS" })
  await h.runtime.recordParentToolResult(caller, "wf_run_node")
  await h.runtime.recordParentToolResult(caller, "wf_run_node", { code: "WF_BAD_ARGS" })
  expect(entry.snapshot.status).toBe("running")
})

it("test_token_budget_sums_authoritative_root_and_child_usage_and_interrupts", async () => {
  const h = await makeHarness()
  h.agents.tokenAccounting = (id) => ({ total: id === "session-1" ? 7 : 4, complete: true, observed: true })
  const flow = makeFlow()
  flow.runtime = { version: 1, budget: { tokenLimit: 10 } }
  const { entry } = await start(h, flow)
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  await expect(h.runtime.enforceRuntimeBudget(entry)).rejects.toMatchObject({ code: "WF_TOKEN_LIMIT" })
  expect(entry.snapshot.usage).toMatchObject({ tokens: 11, tokenAccounting: "available" })
  expect(h.runner.interrupts).toEqual([{ childId: "child-1", sessionId: "session-1" }])
  expect(h.runtime.flowLockInfo(flow.id)).toBeNull()
})

it("test_configured_token_budget_without_usage_is_explicitly_unavailable", async () => {
  const h = await makeHarness()
  const flow = makeFlow()
  flow.runtime = { version: 1, budget: { tokenLimit: 100 } }
  const { entry } = await start(h, flow)
  await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a1" })).rejects.toMatchObject({ code: "WF_TOKEN_ACCOUNTING_UNAVAILABLE" })
  expect(h.runner.calls).toEqual([])
  expect(entry.snapshot.usage?.tokenAccounting).toBe("unavailable")
  expect(h.runtime.flowLockInfo(flow.id)).toBeNull()
})

it("test_watchdog_missing_child_liveness_never_allows_uncertain_redispatch", async () => {
  const h = await makeHarness({ runExecutionTimeoutMs: 10000 })
  const { entry } = await start(h, makeFlow())
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  h.clock.now += 1000
  await sweepWatchdogOnce(h.runtime)
  await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a1" })).rejects.toMatchObject({ code: "WF_BUSY" })
  expect(h.runner.calls).toHaveLength(1)
  h.clock.now += 10000
  await sweepWatchdogOnce(h.runtime)
  expect(entry.snapshot.status).toBe("stopped")
  expect(h.agents.cancellations).toHaveLength(1)
})
