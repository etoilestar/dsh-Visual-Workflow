import { expect, it } from "vitest"
import { assertInvocationCurrent, resolveNodeDependencies } from "../../../src/host/orchestrator/dependency-resolution.js"
import { createRunSnapshot, setNodeStatus } from "../../../src/host/orchestrator/snapshot.js"
import { agent, makeFlow } from "./fixtures/harness.js"
import type { RoleNode } from "../../../src/host/shared/graph-model.js"

function fixture() {
  const flow = makeFlow()
  flow.nodes = flow.nodes.filter((node) => node.kind !== "pause")
  flow.lines = [{ id: "serial", source: "n-a1", target: "n-a2", sourceHandle: "flow-out", targetHandle: "flow-in" }]
  const snapshot = createRunSnapshot({ runId: "run-1", sessionId: "session-1", flow, mode: "mode1", now: 1000 })
  const target = flow.nodes.find((node) => node.id === "n-a2") as RoleNode
  setNodeStatus(snapshot, "n-a1", "ok", { attempts: 1, output: "settled text", now: 1000 })
  return { flow, snapshot, target }
}

it("test_legacy_control_only_keeps_explicit_data_semantics", () => {
  const { flow, snapshot, target } = fixture()
  const result = resolveNodeDependencies(flow, target, snapshot)
  expect(result.contextEdges).toEqual([])
  expect(result.invocation.inputs).toEqual({})
})

it("test_auto_serial_flow_transfers_only_settled_text", () => {
  const { flow, snapshot, target } = fixture()
  snapshot.handoffPolicy = "auto"
  expect(resolveNodeDependencies(flow, target, snapshot).invocation.inputs["n-a1.response"]).toEqual([{ kind: "text", value: "settled text", origin: { source: "node", runId: "run-1", nodeId: "n-a1", attempt: 1, output: "response" } }])
})

it.each(["running", "pending", "fail"] as const)("test_auto_control_dependency_%s_blocks_downstream", (status) => {
  const { flow, snapshot, target } = fixture()
  snapshot.handoffPolicy = "auto"
  setNodeStatus(snapshot, "n-a1", status)
  expect(() => resolveNodeDependencies(flow, target, snapshot)).toThrow(expect.objectContaining({ code: "WF_DEPENDENCY_UNSATISFIED" }))
})

it("test_named_json_result_and_artifact_preserve_structures_and_generation", () => {
  const { flow, snapshot, target } = fixture()
  snapshot.handoffPolicy = "auto"
  const source = snapshot.nodes.find((node) => node.nodeId === "n-a1")!
  source.result = { status: "succeeded", confirmation: "verified", runId: "run-1", nodeId: "n-a1", attempt: 1, outputs: { facts: { total: 9 } }, artifacts: [{ name: "report", path: "/workspace/report.md", size: 20, verifiedAt: "now", runId: "run-1", nodeId: "n-a1", attempt: 1 }] }
  target.data.execution = { inputs: { data: { kind: "json", source: { nodeId: "n-a1", output: "facts" } } } }
  const result = resolveNodeDependencies(flow, target, snapshot)
  expect(result.invocation.inputs.data[0]).toMatchObject({ kind: "json", value: { total: 9 }, origin: { attempt: 1 } })
  expect(result.invocation.inputs["n-a1.report"][0]).toMatchObject({ kind: "file", fileRef: { path: "/workspace/report.md" } })
})

it("test_explicit_user_slot_wins_over_automatic_candidate", () => {
  const { flow, snapshot, target } = fixture()
  snapshot.handoffPolicy = "auto"
  target.data.execution = { inputs: { topic: { kind: "text" } } }
  snapshot.runtimeInputs = { workflowInputs: {}, nodeInputs: { "n-a2": { topic: [{ kind: "text", value: "user choice" }] } } }
  expect(resolveNodeDependencies(flow, target, snapshot).invocation.inputs.topic).toEqual([{ kind: "text", value: "user choice" }])
})

it("test_multiple_candidates_require_source_and_keep_independent_names", () => {
  const { flow, snapshot, target } = fixture()
  flow.nodes.push(agent("other", "other"))
  snapshot.nodes.push({ nodeId: "other", status: "pending", attempts: 0, startedAt: null, endedAt: null, output: "", outputSummary: "" })
  flow.lines.push({ id: "parallel", source: "other", target: target.id, sourceHandle: "flow-out", targetHandle: "flow-in" })
  setNodeStatus(snapshot, "other", "ok", { attempts: 1, output: "second" })
  snapshot.handoffPolicy = "auto"
  target.data.execution = { inputs: { topic: { kind: "text" } } }
  expect(() => resolveNodeDependencies(flow, target, snapshot)).toThrow(expect.objectContaining({ code: "WF_HANDOFF_AMBIGUOUS" }))
  target.data.execution.inputs!.topic.source = { nodeId: "other", output: "response" }
  const inputs = resolveNodeDependencies(flow, target, snapshot).invocation.inputs
  expect(inputs.topic[0]).toMatchObject({ value: "second" })
  expect(Object.keys(inputs)).toEqual(["topic", "n-a1.response", "other.response"])
})

it("test_condition_selection_does_not_consume_unselected_context", () => {
  const { flow, snapshot, target } = fixture()
  flow.nodes.push(agent("other", "other"))
  snapshot.nodes.push({ nodeId: "other", status: "pending", attempts: 0, startedAt: null, endedAt: null, output: "", outputSummary: "" })
  flow.lines[0].condition = { type: "pass" }
  flow.lines.push({ id: "other-branch", source: "other", target: target.id, sourceHandle: "flow-out", targetHandle: "flow-in", condition: { type: "pass" } }, { id: "other-context", source: "other", target: target.id, sourceHandle: "ctx-out", targetHandle: "ctx-in" })
  setNodeStatus(snapshot, "other", "ok", { attempts: 1, output: "unselected" })
  snapshot.handoffPolicy = "auto"
  expect(() => resolveNodeDependencies(flow, target, snapshot)).toThrow(expect.objectContaining({ code: "WF_HANDOFF_AMBIGUOUS" }))
  const result = resolveNodeDependencies(flow, target, snapshot, ["serial"])
  expect(result.invocation.inputs["other.response"]).toBeUndefined()
  expect(result.contextEdges.map((edge) => edge.source)).toEqual(["n-a1"])
  expect(() => resolveNodeDependencies(flow, target, snapshot, ["unknown"])).toThrow(expect.objectContaining({ code: "WF_BAD_ARGS" }))
})

it("test_output_reference_without_name_rejects_multiple_outputs", () => {
  const { flow, snapshot, target } = fixture()
  snapshot.nodes.find((node) => node.nodeId === "n-a1")!.result = { status: "succeeded", confirmation: "verified", runId: "run-1", nodeId: "n-a1", attempt: 1, outputs: { first: 1, second: 2 }, artifacts: [] }
  snapshot.runtimeInputs = { workflowInputs: {}, nodeInputs: { "n-a2": { value: [{ kind: "output", nodeId: "n-a1" }] } } }
  expect(() => resolveNodeDependencies(flow, target, snapshot)).toThrow(expect.objectContaining({ code: "WF_HANDOFF_AMBIGUOUS" }))
})

it("test_proxy_reference_resolves_main_and_stale_pinned_attempt_is_rejected", () => {
  const { flow, snapshot, target } = fixture()
  flow.nodes.push({ id: "proxy", kind: "proxy", proxySourceId: "n-a1", position: { x: 0, y: 0 } })
  snapshot.runtimeInputs = { workflowInputs: {}, nodeInputs: { "n-a2": { value: [{ kind: "output", nodeId: "proxy", attempt: 1 }] } } }
  expect(resolveNodeDependencies(flow, target, snapshot).invocation.inputs.value[0]).toMatchObject({ value: "settled text" })
  snapshot.runtimeInputs.nodeInputs["n-a2"].value = [{ kind: "output", nodeId: "proxy", attempt: 2 }]
  expect(() => resolveNodeDependencies(flow, target, snapshot)).toThrow(expect.objectContaining({ code: "WF_DEPENDENCY_UNSATISFIED" }))
})

it("test_invocation_upstream_retry_during_authorization_is_rejected", () => {
  const { flow, snapshot, target } = fixture()
  snapshot.handoffPolicy = "auto"
  const { invocation } = resolveNodeDependencies(flow, target, snapshot)
  setNodeStatus(snapshot, "n-a1", "running", { attempts: 2 })
  expect(() => assertInvocationCurrent(snapshot, invocation)).toThrow(expect.objectContaining({ code: "WF_DEPENDENCY_UNSATISFIED" }))
})

it("test_cycle_self_reference_requires_exact_previous_attempt", () => {
  const { flow, snapshot } = fixture()
  const target = flow.nodes.find((node) => node.id === "n-a1") as RoleNode
  snapshot.runtimeInputs = { workflowInputs: {}, nodeInputs: { "n-a1": { previous: [{ kind: "output", nodeId: "n-a1" }] } } }
  expect(() => resolveNodeDependencies(flow, target, snapshot)).toThrow(expect.objectContaining({ code: "WF_HANDOFF_AMBIGUOUS" }))
  snapshot.runtimeInputs.nodeInputs["n-a1"].previous = [{ kind: "output", nodeId: "n-a1", attempt: 1 }]
  expect(resolveNodeDependencies(flow, target, snapshot).invocation.attempt).toBe(2)
})
