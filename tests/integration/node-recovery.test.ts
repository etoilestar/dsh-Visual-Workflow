// Real runner + runtime + permission/prompt setup + persistence; only the DSH transport is fake.
import { afterEach, expect, it } from "vitest"
import type { NodeStartInput } from "../../src/host/orchestrator/index.js"
import { NodeAgentRunner } from "../../src/host/agent/runner.js"
import type { SubagentsServiceLike } from "../../src/host/agent/runner.js"
import { createChildToolFilterSetup } from "../../src/host/agent/child-tool-filter.js"
import { createChildPromptSetup } from "../../src/host/agent/prompt-setup.js"
import { createModelSelectionSetup } from "../../src/host/agent/model-selection.js"
import { createReactGuard } from "../../src/host/agent/guards.js"
import { caller, cleanupTempDirs, makeFlow, makeHarness, start } from "../host/orchestrator/fixtures/harness.js"

afterEach(cleanupTempDirs)

it("test_recovery_NOT_RESUMABLE_one_attempt_replaces_child_and_isolates_late_end", async () => {
  const h = await makeHarness()
  const flow = makeFlow()
  const node = flow.nodes.find((node) => node.id === "n-a1")!
  if (node.kind !== "agent") throw new Error("fixture")
  node.data.presetId = "standard"
  node.data.systemPrompt = "节点独立角色"
  const toolFilter = createChildToolFilterSetup()
  const promptSetup = createChildPromptSetup()
  const starts: Parameters<SubagentsServiceLike["startContinuable"]>[0][] = []
  const accepted: string[] = []
  let resumable = true
  const transport: SubagentsServiceLike = {
    list: () => ["spawn"],
    startContinuable: async (spec) => {
      // Creation-window state is real AsyncLocalStorage, never broadened on recovery.
      expect(toolFilter.peekPending?.()).toEqual(["read", "write"])
      expect(promptSetup.peekPending()).toMatchObject({ systemPrompt: node.data.systemPrompt })
      starts.push(spec)
      const childId = `child-${starts.length}`
      h.runtime.handleSubagentStart({ id: childId, runId: `epoch-${starts.length}` })
      accepted.push(childId)
      return { childId }
    },
    sendMessage: async (_sender, childId) => {
      if (!resumable) throw Object.assign(new Error("持久化子代理不可恢复", { cause: new Error("持久会话不可用") }), { name: "SubagentError", code: "NOT_RESUMABLE" })
      accepted.push(childId)
    },
    interrupt: () => {},
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
  const { entry } = await start(h, flow)
  await h.runtime.wfRunNode(caller, { nodeId: node.id, retryLimit: 1 })
  await h.runtime.handleSubagentEnd({ id: "child-1", runId: "epoch-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "第一轮完成" }] })
  resumable = false
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
  runner.dispose()
})
