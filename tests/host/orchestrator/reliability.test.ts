import { afterEach, describe, expect, it } from "vitest"
import { buildResumedSnapshot, createRunSnapshot } from "../../../src/host/orchestrator/index.js"
import { caller, cleanupTempDirs, makeHarness, makeFlow, start, stage, agent, groupNode } from "./fixtures/harness.js"

afterEach(cleanupTempDirs)

describe("runtime failure evidence", () => {
  it('test_first_child_request_before_registration_preserves_actual_route', async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.recordModelRoute('session-1', { provider: 'parent-provider', model: 'parent-model' })
    h.runner.startNodeTask = async () => {
      await h.runtime.recordModelRoute('early-child', { provider: 'child-provider', model: 'actual-child-model' }, { pendingChild: true })
      return { childId: 'early-child', created: true }
    }
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const snapshot = (await h.store.getRun('run-1'))!
    expect(snapshot.parentRoute).toEqual({ provider: 'parent-provider', model: 'parent-model' })
    expect(snapshot.nodes.find((node) => node.nodeId === 'n-a1')).toMatchObject({ provider: 'child-provider', model: 'actual-child-model', attemptHistory: [{ childId: 'early-child', provider: 'child-provider', model: 'actual-child-model' }] })
  })

  it('test_team_partial_creation_records_started_failed_and_unattempted_members', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    flow.nodes = [stage('s', 'start'), groupNode('g', '团队', ['a', 'b', 'c']), ...['a', 'b', 'c'].map((id) => agent(id, id, { groupId: 'g' })), stage('e', 'end')]
    flow.lines = [{ id: 'sg', source: 's', target: 'g', sourceHandle: 'flow-out', targetHandle: 'flow-in' }, { id: 'ge', source: 'g', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in' }]
    h.runner.teamEnabled = true
    h.runner.startGroupTask = async (input) => {
      await input.onMemberStarting?.('a')
      await input.onMemberStarted?.({ nodeId: 'a', target: 'm-a', childId: 'started-a', reused: false })
      await input.onMemberStarting?.('b')
      throw new Error('second member initialization failed')
    }
    await start(h, flow)
    await expect(h.runtime.wfRunNode(caller, { nodeId: 'g' })).rejects.toThrow('second member')
    const snapshot = (await h.store.getRun('run-1'))!
    expect(snapshot.nodes.find((node) => node.nodeId === 'a')).toMatchObject({ status: 'running', attempts: 1, childId: 'started-a' })
    expect(snapshot.nodes.find((node) => node.nodeId === 'b')).toMatchObject({ status: 'fail', attempts: 1, failure: { code: 'WF_TEAM_START_FAILED' } })
    expect(snapshot.nodes.find((node) => node.nodeId === 'c')).toMatchObject({ status: 'pending', attempts: 0 })
    expect(h.runtime.childMetaFor('started-a')?.nodeId).toBe('a')
    await h.runtime.handleSubagentEnd({ id: 'started-a', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '真实成员产出' }] })
    expect((await h.store.getRun('run-1'))!.nodes.find((node) => node.nodeId === 'a')).toMatchObject({ status: 'armed', output: '真实成员产出' })
  })
  it("test_child_start_failure_persisted_with_attempt_and_phase", async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    h.runner.nextFail = new Error("initialization failed")
    await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a1" })).rejects.toThrow("initialization failed")
    const first = (await h.store.getRun("run-1"))!.nodes.find((node) => node.nodeId === "n-a1")!
    expect(first).toMatchObject({ status: "fail", attempts: 1, stopReason: "start-error", failure: { phase: "child_start", code: "WF_CHILD_START_FAILED", message: "initialization failed", retryable: false } })
    expect(first.childId).toBeUndefined()
    expect(first.attemptHistory).toHaveLength(1)
    await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
    await h.runtime.handleSubagentEnd({ id: "child-1", stopReason: "completed", lastAssistantMessage: [{ type: "text", text: "actual result" }] })
    const retried = (await h.store.getRun("run-1"))!.nodes.find((node) => node.nodeId === "n-a1")!
    expect(retried).toMatchObject({ status: "ok", attempts: 2, output: "actual result", stopReason: "completed" })
    expect(retried.failure).toBeUndefined()
    expect(retried.attemptHistory).toHaveLength(2)
    expect(retried.attemptHistory![0].failure?.message).toBe("initialization failed")
    expect(retried.attemptHistory![1].childId).toBe("child-1")
  })

  it.each(["error", "aborted", "max-tokens"])("test_child_stop_reason_%s_remains_failed", async (stopReason) => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
    await h.runtime.handleSubagentEnd({ id: "child-1", stopReason, lastAssistantMessage: [{ type: "text", text: "partial output" }] })
    expect((await h.store.getRun("run-1"))!.nodes.find((node) => node.nodeId === "n-a1")).toMatchObject({
      status: "fail", stopReason, childId: "child-1", output: "partial output", failure: { phase: "child_execute" },
    })
  })

  it("test_zero_business_attempts_parent_model_error_has_termination_source", async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    const error = Object.assign({ message: "provider timeout api_key=hidden" }, { code: "MODEL_TIMEOUT" })
    await h.runtime.failRunForParentError(entry, error)
    const snapshot = (await h.store.getRun("run-1"))!
    expect(snapshot.status).toBe("failed")
    expect(snapshot.nodes.filter((node) => ["n-a1", "n-a2"].includes(node.nodeId)).every((node) => node.attempts === 0 && node.status === "skipped")).toBe(true)
    expect(snapshot.termination).toMatchObject({ source: "parent_error", stopReason: "error", failure: { code: "MODEL_TIMEOUT", phase: "parent_execute" } })
    expect(snapshot.termination!.failure!.message).not.toContain("hidden")
  })

  it("test_active_failure_finish_is_distinct_from_model_error", async () => {
    const h = await makeHarness()
    await start(h, makeFlow())
    await h.runtime.wfFinish(caller, { status: "failed", summary: "missing input" })
    expect((await h.store.getRun("run-1"))!.termination).toMatchObject({ source: "parent_finish", failure: { code: "WF_PARENT_FINISH_FAILED", message: "missing input" } })
  })
})

describe("topological resume frontier", () => {
  it("test_skipped_start_failed_business_reordered_nodes_resumes_business", () => {
    const flow = makeFlow()
    flow.nodes.reverse()
    const prev = createRunSnapshot({ runId: "old", flow, sessionId: "session-1", mode: "mode1" })
    prev.status = "stopped"
    prev.nodes.find((node) => node.nodeId === "n-start")!.status = "skipped"
    prev.nodes.find((node) => node.nodeId === "n-a1")!.status = "fail"
    const resumed = buildResumedSnapshot({ prev, runId: "new", flow, sessionId: "session-1", mode: "mode1" })
    expect(resumed.resumeFromNodeId).toBe("n-a1")
    expect(resumed.resumeNodeIds).toEqual(["n-a1"])
  })

  it("test_dag_join_waits_for_all_predecessors_and_preserves_full_checkpoints", () => {
    const flow = makeFlow()
    flow.nodes = [stage("s", "start"), agent("a", "A"), agent("b", "B"), agent("join", "join"), stage("e", "end")]
    flow.lines = [["s", "a"], ["s", "b"], ["a", "join"], ["b", "join"], ["join", "e"]].map(([source, target], index) => ({ id: String(index), source, target, sourceHandle: "flow-out", targetHandle: "flow-in" }))
    const prev = createRunSnapshot({ runId: "old", flow, sessionId: "session-1", mode: "mode1" })
    Object.assign(prev.nodes.find((node) => node.nodeId === "a")!, { status: "react-capped", output: "complete checkpoint", stopReason: "completed", turns: [{ startedAt: null, endedAt: "time", outputSummary: "turn" }] })
    let resumed = buildResumedSnapshot({ prev, runId: "new", flow, sessionId: "session-1", mode: "mode1" })
    expect(resumed.resumeNodeIds).toEqual(["b"])
    expect(resumed.nodes.find((node) => node.nodeId === "a")).toMatchObject({ output: "complete checkpoint", stopReason: "completed", resumed: true, turns: [{ outputSummary: "turn" }] })
    prev.nodes.find((node) => node.nodeId === "b")!.status = "ok"
    resumed = buildResumedSnapshot({ prev, runId: "new", flow, sessionId: "session-1", mode: "mode1" })
    expect(resumed.resumeNodeIds).toEqual(["join"])
  })

  it("test_completed_pause_is_checkpoint_not_next_business_call", () => {
    const flow = makeFlow()
    const prev = createRunSnapshot({ runId: "old", flow, sessionId: "session-1", mode: "mode1" })
    prev.resumeFromNodeId = "n-pause"
    for (const id of ["n-a1", "n-pause"]) prev.nodes.find((node) => node.nodeId === id)!.status = "ok"
    const resumed = buildResumedSnapshot({ prev, runId: "new", flow, sessionId: "session-1", mode: "mode1" })
    expect(resumed.checkpointNodeId).toBe("n-pause")
    expect(resumed.resumeNodeIds).toEqual(["n-a2"])
  })

  it("test_completed_group_and_proxy_sources_unlock_downstream_without_rerun", () => {
    const flow = makeFlow()
    flow.nodes = [stage("s", "start"), groupNode("g", "team", ["a"]), agent("a", "A"), agent("b", "B"), { id: "p", kind: "proxy", position: { x: 0, y: 0 }, proxySourceId: "b" }, stage("e", "end")]
    flow.lines = [["s", "g"], ["g", "p"], ["p", "e"]].map(([source, target], index) => ({ id: String(index), source, target, sourceHandle: "flow-out", targetHandle: "flow-in" }))
    const prev = createRunSnapshot({ runId: "old", flow, sessionId: "session-1", mode: "mode1" })
    prev.nodes.find((node) => node.nodeId === "a")!.status = "ok"
    expect(buildResumedSnapshot({ prev, runId: "new", flow, sessionId: "session-1", mode: "mode1" }).resumeNodeIds).toEqual(["p"])
    prev.nodes.find((node) => node.nodeId === "b")!.status = "ok"
    expect(buildResumedSnapshot({ prev, runId: "new", flow, sessionId: "session-1", mode: "mode1" }).resumeNodeIds).toEqual([])
  })
})
