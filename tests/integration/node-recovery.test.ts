// Real runner + runtime + permission/prompt setup + persistence; only the DSH transport is fake.
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

async function makeRealRunnerHarness(nodeId = "n-a1") {
  const h = await makeHarness()
  const flow = makeFlow()
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
      expect(promptSetup.peekPending()).toMatchObject({ systemPrompt: node.data.systemPrompt })
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
  const { entry } = await start(h, flow)
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
