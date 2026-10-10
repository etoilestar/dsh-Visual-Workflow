import { runtimeManagedPrefix } from "../../src/host/storage/managed-files.js"
// Real runner + runtime + permission/prompt setup + persistence; only the DSH transport is fake.
import { mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, it, onTestFinished, vi } from "vitest"
import type { NodeStartInput } from "../../src/host/orchestrator/index.js"
import { NodeAgentRunner } from "../../src/host/agent/runner.js"
import type { SubagentsServiceLike } from "../../src/host/agent/runner.js"
import { createChildToolFilterSetup } from "../../src/host/agent/child-tool-filter.js"
import { createChildPromptSetup } from "../../src/host/agent/prompt-setup.js"
import { createModelSelectionSetup } from "../../src/host/agent/model-selection.js"
import { createReactGuard } from "../../src/host/agent/guards.js"
import { caller, cleanupTempDirs, makeFlow, makeHarness, start } from "../host/orchestrator/fixtures/harness.js"

afterEach(cleanupTempDirs)

async function makeRealRunnerHarness(nodeId = "n-a1", options: { configure?: (flow: import("../../src/host/shared/graph-model.js").WorkflowDocument) => void; runtimeInputs?: unknown; handoffPolicy?: unknown; authorizedInputFiles?: () => Promise<readonly string[]>; sessionInputFiles?: () => Promise<readonly import("../../src/host/shared/runtime-types.js").SessionInputFile[]> } = {}) {
  const h = await makeHarness(undefined, { workingDirectory: async () => h.dir, sessionInputFiles: options.sessionInputFiles, authorizedInputFiles: options.authorizedInputFiles })
  const flow = makeFlow()
  options.configure?.(flow)
  for (const configured of flow.nodes) if (configured.kind === "agent") configured.data.presetId = "standard"
  const node = flow.nodes.find((node) => node.id === nodeId)!
  if (node.kind !== "agent") throw new Error("fixture")
  node.data.presetId = "standard"
  node.data.systemPrompt = "节点独立角色"
  const toolFilter = createChildToolFilterSetup()
  const promptSetup = createChildPromptSetup()
  const starts: Parameters<SubagentsServiceLike["startContinuable"]>[0][] = []
  const accepted: string[] = []
  const sent: string[] = []
  const interrupted: string[] = []
  const epochs = new Map<string, string>()
  const control: { resumable: boolean; startGate?: Promise<void>; onStart?: () => void } = { resumable: true }
  let epoch = 0
  const activate = (childId: string) => {
    const runId = `epoch-${++epoch}`
    epochs.set(childId, runId)
    h.runtime.handleSubagentStart({ id: childId, runId })
    accepted.push(childId)
  }
  const transport: SubagentsServiceLike = {
    list: () => ["spawn"],
    startContinuable: async (spec) => {
      // Creation-window state is real AsyncLocalStorage, never broadened on recovery.
      expect(toolFilter.peekPending?.()).toEqual(["read", "write"])
      const executing = flow.nodes.find((candidate) => candidate.kind === "agent" && spec.request.prompt.some((block) => block.text.includes(`「${candidate.data.label}」`)))
      expect(promptSetup.peekPending()).toMatchObject({ systemPrompt: executing?.kind === "agent" ? executing.data.systemPrompt : node.data.systemPrompt })
      starts.push(spec)
      control.onStart?.()
      await control.startGate
      const childId = `child-${starts.length}`
      activate(childId)
      return { childId }
    },
    sendMessage: async (_sender, childId) => {
      sent.push(childId)
      if (!control.resumable) throw Object.assign(new Error("持久化子代理不可恢复", { cause: new Error("持久会话不可用") }), { name: "SubagentError", code: "NOT_RESUMABLE" })
      activate(childId)
    },
    interrupt: (childId) => { interrupted.push(childId) },
  }
  const retired: string[] = []
  const runner = new NodeAgentRunner({
    store: h.store,
    agents: () => ({ get: (id) => h.agents.getRootAgent(id) }),
    subagents: () => transport,
    teams: () => null,
    toolsView: { visibleToolNames: async () => ["read", "write"], agentToolNames: async () => ["read", "write"], presetToolNames: async () => ["read", "write"] },
    toolFilter, promptSetup, modelSelection: createModelSelectionSetup(), react: createReactGuard().bridge,
    retireChild: (id) => { retired.push(id); toolFilter.remember(id, undefined) },
  })
  const dispatched: NodeStartInput[] = []
  h.runner.startNodeTask = (input) => { dispatched.push(input); return runner.startNodeTask(input) }
  h.runner.interruptChild = (childId, sessionId) => runner.interruptChild(childId, sessionId)
  onTestFinished(() => { h.runtime.dispose(); runner.dispose() })
  await h.store.saveWorkflow(flow, "session-1", { force: true })
  await h.runtime.startRun({ sessionId: "session-1", flowId: flow.id, runtimeInputs: typeof options.runtimeInputs === "function" ? await options.runtimeInputs(h.dir) : options.runtimeInputs, handoffPolicy: options.handoffPolicy })
  const entry = h.runtime.activeRunForSession("session-1")!
  const settle = (childId: string, stopReason = "completed") => h.runtime.handleSubagentEnd({ id: childId, runId: epochs.get(childId), stopReason })
  return { h, node, entry, starts, accepted, sent, interrupted, epochs, control, retired, dispatched, settle }
}

it("test_recovery_NOT_RESUMABLE_one_attempt_replaces_child_and_isolates_late_end", async () => {
  const { h, node, entry, control, starts, accepted, retired, dispatched } = await makeRealRunnerHarness()
  await h.runtime.wfRunNode(caller, { nodeId: node.id, retryLimit: 1 })
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "第一轮完成" }] })
  control.resumable = false
  const second = await h.runtime.wfRunNode(caller, { nodeId: node.id, retryLimit: 1 })
  expect(second.childId).toBe("child-2")
  expect(starts).toHaveLength(2)
  expect(accepted).toEqual(["child-1", "child-2"])
  expect(starts[1].request.prompt).toEqual(dispatched[1].blocks)
  expect(starts[1].request.prompt[0].text).toContain("子任务A")
  expect(entry.snapshot.nodes.find((record) => record.nodeId === node.id)).toMatchObject({ attempts: 2, childId: "child-2", status: "running" })
  expect(entry.callCount).toBe(2)
  expect(retired).toEqual(["child-1"])
  expect(h.runtime.childMetaFor("child-1")).toMatchObject({ retired: true })
  expect(h.runtime.childMetaFor("child-2")).toMatchObject({ runId: entry.snapshot.id, attempt: 2, hostEpochId: "epoch-2" })
  const parentMessages = h.agents.roots.get("session-1")!.messages.length
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "error" })
  expect(entry.snapshot.nodes.find((record) => record.nodeId === node.id)!.status).toBe("running")
  expect(h.agents.roots.get("session-1")!.messages).toHaveLength(parentMessages)
  await h.runtime.handleSubagentEnd({ id: "child-2", runId: "epoch-2", stopReason: "completed" })
  await expect(h.runtime.wfRunNode(caller, { nodeId: node.id, retryLimit: 1 })).rejects.toMatchObject({ code: "WF_RETRY_LIMIT" })
  expect(starts).toHaveLength(2)
  await h.runtime.wfFinish(caller, { status: "failed" })
  expect(h.runtime.activeRunForSession("session-1")).toBeNull()
})

it.each(["n-a1", "n-a2", "n-proxy-a2"])("test_dispatch_%s_unsettled_child_is_busy_without_consuming_budget", async (requestedNodeId) => {
  const canonicalNodeId = requestedNodeId === "n-proxy-a2" ? "n-a2" : requestedNodeId
  const { h, entry, starts, sent, accepted, dispatched } = await makeRealRunnerHarness(canonicalNodeId)
  const args = { nodeId: requestedNodeId, retryLimit: 0 }
  await expect(h.runtime.wfRunNode(caller, args)).resolves.toMatchObject({ status: "started", nodeId: canonicalNodeId, childId: "child-1" })

  await expect(h.runtime.wfRunNode(caller, args)).rejects.toMatchObject({ code: "WF_BUSY" })

  expect(entry.callCount).toBe(1)
  expect(entry.attempts.get(canonicalNodeId)).toBe(1)
  expect(entry.snapshot.nodes.find((record) => record.nodeId === canonicalNodeId)).toMatchObject({ status: "running", attempts: 1, childId: "child-1" })
  expect(starts).toHaveLength(1)
  expect(sent).toEqual([])
  expect(accepted).toEqual(["child-1"])
  expect(dispatched).toHaveLength(1)
})

it.each(["completed", "error"])("test_dispatch_%s_settlement_allows_cached_child_retry_within_budget", async (stopReason) => {
  const { h, node, entry, starts, sent, dispatched, settle } = await makeRealRunnerHarness()
  const args = { nodeId: node.id, retryLimit: 1 }
  await h.runtime.wfRunNode(caller, args)
  // A stale host epoch cannot release the execution-window mutex.
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-stale", stopReason })
  await expect(h.runtime.wfRunNode(caller, args)).rejects.toMatchObject({ code: "WF_BUSY" })
  expect(entry.callCount).toBe(1)
  await settle("child-1", stopReason)
  expect(entry.snapshot.nodes.find((record) => record.nodeId === node.id)?.status).toBe(stopReason === "completed" ? "ok" : "fail")

  await expect(h.runtime.wfRunNode(caller, args)).resolves.toMatchObject({ status: "started", childId: "child-1" })

  expect(starts).toHaveLength(1)
  expect(sent).toEqual(["child-1"])
  expect(dispatched).toHaveLength(2)
  expect(entry.callCount).toBe(2)
  expect(entry.snapshot.nodes.find((record) => record.nodeId === node.id)).toMatchObject({ status: "running", attempts: 2 })
  expect(h.runtime.childMetaFor("child-1")).toMatchObject({ attempt: 2, hostEpochId: "epoch-2" })
  await expect(h.runtime.wfRunNode(caller, args)).rejects.toMatchObject({ code: "WF_BUSY" })
  expect(entry.attempts.get(node.id)).toBe(2)
  await settle("child-1")
  await expect(h.runtime.wfRunNode(caller, args)).rejects.toMatchObject({ code: "WF_RETRY_LIMIT" })
  expect(sent).toHaveLength(1)
})

it.each([["n-a2", "n-proxy-a2"], ["n-proxy-a2", "n-a2"]])("test_dispatch_%s_and_%s_share_startup_and_execution_mutex", async (firstNodeId, secondNodeId) => {
  const { h, entry, control, starts, sent, dispatched } = await makeRealRunnerHarness("n-a2")
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  control.startGate = new Promise<void>((resolve) => { release = resolve })
  control.onStart = entered
  const first = h.runtime.wfRunNode(caller, { nodeId: firstNodeId })
  await started
  try {
    await expect(h.runtime.wfRunNode(caller, { nodeId: secondNodeId })).rejects.toMatchObject({ code: "WF_BUSY" })
  } finally { release() }
  await expect(first).resolves.toMatchObject({ status: "started", childId: "child-1" })
  await expect(h.runtime.wfRunNode(caller, { nodeId: secondNodeId })).rejects.toMatchObject({ code: "WF_BUSY" })
  expect(entry.callCount).toBe(1)
  expect(entry.attempts.get("n-a2")).toBe(1)
  expect(starts).toHaveLength(1)
  expect(sent).toEqual([])
  expect(dispatched).toHaveLength(1)
})

it("test_dispatch_settlement_validation_pending_remains_busy_until_verified", async () => {
  const { h, node, entry, sent, settle } = await makeRealRunnerHarness()
  await h.runtime.wfRunNode(caller, { nodeId: node.id })
  let entered!: () => void
  let release!: () => void
  const checking = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const original = h.store.getWorkflow.bind(h.store)
  vi.spyOn(h.store, "getWorkflow").mockImplementationOnce(async (...args) => { entered(); await gate; return original(...args) })
  const settlement = settle("child-1")
  await checking
  try {
    await expect(h.runtime.wfRunNode(caller, { nodeId: node.id })).rejects.toMatchObject({ code: "WF_BUSY" })
    expect(entry.callCount).toBe(1)
    expect(sent).toEqual([])
  } finally { release() }
  await settlement
  await expect(h.runtime.wfRunNode(caller, { nodeId: node.id })).resolves.toMatchObject({ status: "started" })
  expect(sent).toEqual(["child-1"])
})

it("test_dispatch_stopped_checkpoint_resumes_without_stale_busy_and_rejects_old_epoch", async () => {
  const { h, node, entry, interrupted, sent, starts, settle } = await makeRealRunnerHarness()
  await h.runtime.wfRunNode(caller, { nodeId: node.id })
  await h.runtime.stopRun(entry.snapshot.id)
  expect(interrupted).toEqual(["child-1"])
  expect(entry.inflight.size).toBe(0)
  await h.runtime.resumeRun({ sessionId: "session-1", flowId: "flow-1" })

  await expect(h.runtime.wfRunNode(caller, { nodeId: node.id })).resolves.toMatchObject({ status: "started", childId: "child-1" })

  const current = h.runtime.activeRunForSession("session-1")!
  expect(current.snapshot.id).not.toBe(entry.snapshot.id)
  expect(current.callCount).toBe(1)
  expect(starts).toHaveLength(1)
  expect(sent).toEqual(["child-1"])
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed" })
  await expect(h.runtime.wfRunNode(caller, { nodeId: node.id })).rejects.toMatchObject({ code: "WF_BUSY" })
  expect(current.callCount).toBe(1)
  await settle("child-1")
  expect(current.snapshot.nodes.find((record) => record.nodeId === node.id)?.status).toBe("ok")
})

it("test_dispatch_paused_child_settles_and_checkpoint_retry_rebuilds_unrecoverable_child", async () => {
  const { h, node, entry, control, starts, sent, retired, settle } = await makeRealRunnerHarness()
  await h.runtime.wfRunNode(caller, { nodeId: node.id })
  await h.runtime.suspendRun(entry.snapshot.id)
  await settle("child-1", "error")
  expect(entry.snapshot.status).toBe("paused")
  expect(entry.snapshot.nodes.find((record) => record.nodeId === node.id)?.status).toBe("fail")
  expect(entry.inflight.size).toBe(0)
  control.resumable = false

  // wf_run_node keeps the existing automatic checkpoint takeover semantics.
  await expect(h.runtime.wfRunNode(caller, { nodeId: node.id, retryLimit: 0 })).resolves.toMatchObject({ status: "started", childId: "child-2" })

  const current = h.runtime.activeRunForSession("session-1")!
  expect(current.snapshot.id).not.toBe(entry.snapshot.id)
  expect(current.callCount).toBe(1)
  expect(starts).toHaveLength(2)
  expect(sent).toEqual(["child-1"])
  expect(retired).toEqual(["child-1"])
  await expect(h.runtime.wfRunNode(caller, { nodeId: node.id, retryLimit: 0 })).rejects.toMatchObject({ code: "WF_BUSY" })
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed" })
  expect(current.snapshot.nodes.find((record) => record.nodeId === node.id)).toMatchObject({ status: "running", attempts: 1, childId: "child-2" })
  await settle("child-2")
  expect(current.snapshot.nodes.find((record) => record.nodeId === node.id)?.status).toBe("ok")
})

function serialFlow(flow: import("../../src/host/shared/graph-model.js").WorkflowDocument): void {
  flow.nodes = flow.nodes.filter((node) => node.kind !== "pause")
  flow.lines = [
    { id: "begin", source: "n-start", target: "n-a1", sourceHandle: "flow-out", targetHandle: "flow-in" },
    { id: "next", source: "n-a1", target: "n-a2", sourceHandle: "flow-out", targetHandle: "flow-in" },
    { id: "end", source: "n-a2", target: "n-end", sourceHandle: "flow-out", targetHandle: "flow-in" },
  ]
}

it.each(["text", "json", "file"])("test_input_%s_without_file_node_reaches_first_real_child", async (kind) => {
  const { h, starts, entry } = await makeRealRunnerHarness("n-a1", { configure: serialFlow, runtimeInputs: async (dir: string) => {
    await mkdir(join(dir, "data", "files"), { recursive: true })
    await writeFile(join(dir, "data", "files", `${runtimeManagedPrefix("session-1")}input.txt`), "file content stays on disk")
    const value = kind === "text" ? { kind, value: "USER_TEXT" } : kind === "json" ? { kind, value: { nested: [1, true, null] } } : { kind, fileRef: { source: "managed", path: `data/files/${runtimeManagedPrefix("session-1")}input.txt` } }
    return { workflowInputs: { input: [value] }, nodeInputs: {} }
  } })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  expect(starts).toHaveLength(1)
  const prompt = starts[0].request.prompt.map((block) => block.text).join("\n")
  expect(prompt).toContain(kind === "text" ? "USER_TEXT" : kind === "json" ? "nested" : join(h.dir, "data", "files", `${runtimeManagedPrefix("session-1")}input.txt`))
  expect(prompt).not.toContain("file content stays on disk")
  expect(entry.snapshot.workflowInputNodeId).toBe("n-a1")
  expect((await h.store.getRun(entry.snapshot.id))?.runtimeInputs?.workflowInputs.input[0].kind).toBe(kind)
})

it("test_required_input_missing_no_child_or_budget_then_pending_binding_recovers", async () => {
  const { h, entry, starts } = await makeRealRunnerHarness("n-a1", { configure: (flow) => {
    serialFlow(flow)
    const node = flow.nodes.find((node) => node.id === "n-a2")!
    if (node.kind === "agent") node.data.execution = { inputs: { payload: { kind: "json" } } }
  } })
  await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a2", retryLimit: 0 })).rejects.toMatchObject({ code: "WF_INPUT_REQUIRED" })
  expect(starts).toEqual([])
  expect(entry.callCount).toBe(0)
  expect(entry.snapshot.nodes.find((node) => node.nodeId === "n-a2")).toMatchObject({ status: "pending", attempts: 0 })
  await h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-proxy-a2", expectedRevision: 0, inputs: { payload: [{ kind: "json", value: { ready: true } }] } })
  await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a2", retryLimit: 0 })).resolves.toMatchObject({ status: "started" })
  expect(starts).toHaveLength(1)
  expect(starts[0].request.prompt[0].text).toContain("ready")
  expect(entry.callCount).toBe(1)
  await expect(h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-a2", expectedRevision: 1, inputs: {} })).rejects.toMatchObject({ code: "WF_INPUT_STATE_CONFLICT" })
})

it("test_auto_handoff_text_in_first_downstream_real_child_without_ctx", async () => {
  const { h, starts, entry } = await makeRealRunnerHarness("n-a1", { configure: serialFlow, handoffPolicy: "auto" })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: '{"result":"VALID_JSON_TEXT"}' }] })
  await h.runtime.wfRunNode(caller, { nodeId: "n-proxy-a2" })
  expect(starts).toHaveLength(2)
  expect(starts[1].request.prompt[0].text).toContain("VALID_JSON_TEXT")
  expect(starts[1].request.prompt[0].text).toContain('"attempt": 1')
  expect(starts[1].request.prompt[0].text).toContain(entry.snapshot.id)
  expect(entry.baseFlow.lines.some((line) => line.targetHandle === "ctx-in")).toBe(false)
})

it("test_auto_handoff_file_verified_current_write_reaches_downstream_first_prompt", async () => {
  const { h, starts, entry } = await makeRealRunnerHarness("n-a1", { configure: (flow) => {
    serialFlow(flow)
    const first = flow.nodes.find((node) => node.id === "n-a1")!
    if (first.kind === "agent") first.data.execution = { outputFiles: ["result.json"] }
  }, handoffPolicy: "auto" })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  await writeFile(join(h.dir, "result.json"), '{"private":"FILE_BODY_NOT_IN_PROMPT"}')
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "result ready" }] })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a2" })
  expect(starts[1].request.prompt[0].text).toContain(join(h.dir, "result.json"))
  expect(starts[1].request.prompt[0].text).not.toContain("FILE_BODY_NOT_IN_PROMPT")
  expect(entry.snapshot.nodes.find((node) => node.nodeId === "n-a1")?.artifacts?.[0]).toMatchObject({ runId: entry.snapshot.id, attempt: 1, nodeId: "n-a1", signature: expect.any(String) })
})

it.each(["running", "failed", "retried"])("test_auto_%s_upstream_is_not_usable_and_does_not_start_downstream", async (state) => {
  const { h, entry, starts } = await makeRealRunnerHarness("n-a1", { configure: serialFlow, handoffPolicy: "auto" })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  if (state !== "running") await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: state === "failed" ? "error" : "completed", lastAssistantMessage: [{ type: "text", text: "OLD_ATTEMPT" }] })
  if (state === "retried") {
    await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
    await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "STALE_LATE_OUTPUT" }] })
  }
  await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a2" })).rejects.toMatchObject({ code: "WF_INPUT_UPSTREAM_UNAVAILABLE" })
  expect(starts).toHaveLength(1)
  expect(entry.snapshot.nodes.find((node) => node.nodeId === "n-a2")).toMatchObject({ attempts: 0, status: "pending" })
})

it("test_auto_explicit_binding_overrides_upstream_without_guessing", async () => {
  const { h, starts } = await makeRealRunnerHarness("n-a2", { configure: serialFlow, handoffPolicy: "auto", runtimeInputs: { workflowInputs: {}, nodeInputs: { "n-a2": { input: [{ kind: "text", value: "EXPLICIT_BINDING" }] } } } })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a2" })
  expect(starts[0].request.prompt[0].text).toContain("EXPLICIT_BINDING")
  expect(starts[0].request.prompt[0].text).not.toContain("upstreamText")
})

it("test_binding_inflight_blocks_dispatch_proxy_and_concurrent_binding_then_releases", async () => {
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const { h, entry, starts } = await makeRealRunnerHarness()
  vi.spyOn(h.store, "saveRun").mockImplementationOnce(async (snapshot) => { entered(); await gate; return snapshot })
  const binding = h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-a2", expectedRevision: 0, inputs: { text: [{ kind: "text", value: "NEW" }] } })
  await started
  try {
    await expect(h.runtime.wfRunNode(caller, { nodeId: "n-proxy-a2" })).rejects.toMatchObject({ code: "WF_BUSY" })
    await expect(h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-a2", expectedRevision: 0, inputs: {} })).rejects.toMatchObject({ code: "WF_BUSY" })
    expect(starts).toEqual([])
    expect(entry.callCount).toBe(0)
  } finally { release() }
  await binding
  await expect(h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-a2", expectedRevision: 0, inputs: {} })).rejects.toMatchObject({ code: "WF_INPUT_REVISION_CONFLICT" })
  await h.runtime.wfRunNode(caller, { nodeId: "n-proxy-a2" })
  expect(starts[0].request.prompt[0].text).toContain("NEW")
})

it("test_binding_stop_during_durable_write_cannot_publish_to_terminal_run", async () => {
  const { h, entry, starts } = await makeRealRunnerHarness()
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const save = h.store.saveRun.bind(h.store)
  vi.spyOn(h.store, "saveRun").mockImplementationOnce(async (snapshot) => { entered(); await gate; return save(snapshot) })
  const binding = h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-a2", expectedRevision: 0, inputs: { source: [{ kind: "text", value: "not published" }] } })
  const rejected = expect(binding).rejects.toMatchObject({ code: "WF_CANCELLED" })
  await started
  const stopped = h.runtime.stopRun(entry.snapshot.id)
  release()
  await rejected
  await stopped
  const snapshot = await h.store.getRun(entry.snapshot.id)
  expect(snapshot?.status).toBe("stopped")
  expect(snapshot?.inputRevision).toBeUndefined()
  expect(snapshot?.runtimeInputs).toBeUndefined()
  expect(starts).toEqual([])
})

it("test_binding_save_failure_leaves_revision_unchanged_and_mutex_reusable", async () => {
  const { h, entry, starts } = await makeRealRunnerHarness()
  vi.spyOn(h.store, "saveRun").mockRejectedValueOnce(new Error("disk failed"))
  await expect(h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-a2", expectedRevision: 0, inputs: { source: [{ kind: "text", value: "failed save" }] } })).rejects.toThrow("disk failed")
  expect(entry.snapshot.inputRevision).toBeUndefined()
  expect(entry.snapshot.runtimeInputs).toBeUndefined()
  await h.runtime.bindRuntimeInputs({ sessionId: "session-1", runId: entry.snapshot.id, nodeId: "n-a2", expectedRevision: 0, inputs: { source: [{ kind: "text", value: "accepted" }] } })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a2" })
  expect(starts[0].request.prompt[0].text).toContain("accepted")
  expect(starts[0].request.prompt[0].text).not.toContain("failed save")
})

it("test_resume_auto_preserves_settled_upstream_and_original_input_provenance", async () => {
  const { h, starts, entry } = await makeRealRunnerHarness("n-a1", { configure: serialFlow, handoffPolicy: "auto", runtimeInputs: { workflowInputs: { input: [{ kind: "text", value: "SOURCE" }] }, nodeInputs: {} } })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "PRESERVED_RESULT" }] })
  await h.runtime.stopRun(entry.snapshot.id)
  const resumed = await h.runtime.resumeRun({ sessionId: "session-1", flowId: "flow-1" })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a2" })
  expect(starts).toHaveLength(2)
  expect(starts[1].request.prompt[0].text).toContain("PRESERVED_RESULT")
  expect(starts[1].request.prompt[0].text).toContain('"runId": "run-1"')
  expect(h.runtime.runSnapshot(resumed.runId)?.handoffPolicy).toBe("auto")
  expect(h.runtime.runSnapshot(resumed.runId)?.runtimeInputs?.workflowInputs.input[0]).toMatchObject({ kind: "text", value: "SOURCE" })
})

it("test_upstream_retried_during_downstream_preflight_rejects_stale_first_task_without_budget", async () => {
  let delay = false
  let entered!: () => void
  let release!: () => void
  const enteredGate = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const { h, entry, starts } = await makeRealRunnerHarness("n-a1", { configure: serialFlow, handoffPolicy: "auto", authorizedInputFiles: async () => {
    if (delay) { delay = false; entered(); await gate }
    return []
  } })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "OLD_RESULT" }] })
  delay = true
  const downstream = h.runtime.wfRunNode(caller, { nodeId: "n-a2" })
  const rejected = expect(downstream).rejects.toMatchObject({ code: "WF_INPUT_UPSTREAM_UNAVAILABLE" })
  await enteredGate
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  release()
  await rejected
  expect(starts).toHaveLength(1)
  expect(entry.snapshot.nodes.find((node) => node.nodeId === "n-a2")).toMatchObject({ attempts: 0, status: "pending" })
  expect(entry.callCount).toBe(2)
})

it("test_downstream_preflight_checks_its_inputs_without_requiring_consumed_source_file", async () => {
  const { h, starts } = await makeRealRunnerHarness("n-a1", { configure: serialFlow, handoffPolicy: "auto", runtimeInputs: async (dir: string) => {
    await mkdir(join(dir, "data", "files"), { recursive: true })
    await writeFile(join(dir, "data", "files", `${runtimeManagedPrefix("session-1")}consumed`), "initial")
    return { workflowInputs: { source: [{ kind: "file", fileRef: { source: "managed", path: `data/files/${runtimeManagedPrefix("session-1")}consumed` } }] }, nodeInputs: {} }
  } })
  await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "CURRENT_RESULT" }] })
  await rm(join(h.dir, "data", "files", `${runtimeManagedPrefix("session-1")}consumed`))
  await h.runtime.wfRunNode(caller, { nodeId: "n-a2" })
  expect(starts).toHaveLength(2)
  expect(starts[1].request.prompt[0].text).toContain("CURRENT_RESULT")
  expect(starts[1].request.prompt[0].text).not.toContain(`data/files/${runtimeManagedPrefix("session-1")}consumed`)
})
