import { afterEach, expect, it } from "vitest"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { caller, cleanupTempDirs, makeFlow, makeHarness, start } from "./fixtures/harness.js"

afterEach(cleanupTempDirs)

it("test_start_text_and_json_persist_typed_values_without_graph_mutation", async () => {
  const h = await makeHarness()
  const flow = makeFlow()
  await h.store.saveWorkflow(flow, "session-1", { force: true })
  const inputs = { workflowInputs: { topic: [{ kind: "text", value: "hello" }], facts: [{ kind: "json", value: { count: 3 } }] }, nodeInputs: {}, parameters: { locale: "zh" } }
  const result = await h.runtime.startRun({ sessionId: "session-1", flowId: flow.id, runtimeInputs: inputs })
  expect((await h.store.getRun(result.runId))?.runtimeInputs?.workflowInputs.facts).toEqual([{ kind: "json", value: { count: 3 }, origin: { source: "user" } }])
  expect((await h.store.getWorkflow("session-1", flow.id))?.runtime).toBeUndefined()
  expect(h.agents.roots.get("session-1")?.messages).toHaveLength(1)
})

it("test_start_required_workflow_input_missing_does_not_wake_parent_or_lock", async () => {
  const h = await makeHarness()
  const flow = makeFlow()
  flow.runtime = { version: 1, inputs: { subject: { kind: "text" } } }
  await h.store.saveWorkflow(flow, "session-1", { force: true })
  await expect(h.runtime.startRun({ sessionId: "session-1", flowId: flow.id })).rejects.toMatchObject({ code: "WF_INPUT_REQUIRED" })
  expect(h.agents.roots.get("session-1")?.messages).toEqual([])
  expect(h.runtime.flowLockInfo(flow.id)).toBeNull()
})

it("test_bind_proxy_pending_node_is_canonical_and_revision_checked", async () => {
  const h = await makeHarness()
  const { result } = await start(h, makeFlow())
  const bound = await h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: result.runId, expectedRevision: 0, nodeId: "n-proxy-a2", inputs: { text: [{ kind: "text", value: "bound" }] } })
  expect(bound.inputRevision).toBe(1)
  expect(bound.runtimeInputs?.nodeInputs["n-a2"].text[0]).toMatchObject({ kind: "text", value: "bound" })
  await expect(h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: result.runId, expectedRevision: 0, inputs: {} })).rejects.toMatchObject({ code: "WF_INPUT_REVISION_CONFLICT" })
  expect((await h.store.getRun(result.runId))?.inputRevision).toBe(1)
})

it("test_bind_running_node_rejected_does_not_change_inputs", async () => {
  const h = await makeHarness()
  const { result } = await start(h, makeFlow())
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  await expect(h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: result.runId, expectedRevision: 0, nodeId: "n-a1", inputs: {} })).rejects.toMatchObject({ code: "WF_INPUT_STATE_CONFLICT" })
  expect(h.runtime.runSnapshot(result.runId)?.runtimeInputs).toBeUndefined()
})

it("test_bind_durable_write_failure_does_not_publish_or_leave_busy", async () => {
  const h = await makeHarness()
  const { result } = await start(h, makeFlow())
  const save = h.store.saveRun.bind(h.store)
  h.store.saveRun = async () => { throw new Error("disk unavailable") }
  await expect(h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: result.runId, expectedRevision: 0, nodeId: "n-a1", inputs: {} })).rejects.toThrow("disk unavailable")
  expect(h.runtime.runSnapshot(result.runId)?.inputRevision).toBeUndefined()
  h.store.saveRun = save
  expect((await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })).status).toBe("started")
})

it("test_binding_reserves_dispatch_and_cancel_retains_terminal_state", async () => {
  let entered!: () => void
  let release!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const h = await makeHarness(undefined, { sessionInputFiles: async () => { entered(); await gate; return [] } })
  const { result } = await start(h, makeFlow())
  const pending = h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: result.runId, expectedRevision: 0, nodeId: "n-a1", inputs: {} })
  const rejection = expect(pending).rejects.toMatchObject({ code: "WF_CANCELLED" })
  await ready
  await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a1" })).rejects.toMatchObject({ code: "WF_BUSY" })
  const stop = h.runtime.stopRun(result.runId)
  release()
  await rejection
  await stop
  expect((await h.store.getRun(result.runId))?.status).toBe("stopped")
  expect(h.runner.calls).toEqual([])
})

it("test_resume_preserves_typed_inputs_and_revalidates_file_access", async () => {
  let cwd = ""
  const h = await makeHarness(undefined, { workingDirectory: async () => cwd })
  cwd = h.dir
  await mkdir(join(h.dir, "workspace"))
  const path = join(h.dir, "workspace", "input.txt")
  await writeFile(path, "input")
  const flow = makeFlow()
  await h.store.saveWorkflow(flow, "session-1", { force: true })
  const first = await h.runtime.startRun({ sessionId: "session-1", flowId: flow.id, runtimeInputs: { workflowInputs: { document: [{ kind: "file", fileRef: { source: "workspace", path } }] }, nodeInputs: {} } })
  await h.runtime.stopRun(first.runId)
  const second = await h.runtime.resumeRun({ sessionId: "session-1", flowId: flow.id, fromRunId: first.runId })
  expect(h.runtime.runSnapshot(second.runId)?.runtimeInputs?.workflowInputs.document[0]).toMatchObject({ kind: "file", fileRef: { path } })
  expect(h.runtime.runSnapshot(second.runId)?.inputRevision).toBe(1)
})

it("test_input_options_returns_checkpoint_and_all_executable_nodes", async () => {
  const h = await makeHarness()
  const { result } = await start(h, makeFlow())
  await h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: result.runId, expectedRevision: 0, nodeId: "n-a2", inputs: { topic: [{ kind: "text", value: "retained" }] } })
  await h.runtime.stopRun(result.runId)
  const options = await h.runtime.runtimeInputOptions({ sessionId: "session-1", flowId: "flow-1" })
  expect(options.nodeInputs).toEqual({ "n-a1": {}, "n-a2": {} })
  expect(options.checkpoint?.runtimeInputs?.nodeInputs["n-a2"].topic[0]).toMatchObject({ value: "retained" })
})
