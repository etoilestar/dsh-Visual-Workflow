import { afterEach, expect, it, vi } from "vitest"
import { registerParentToolBoundary } from "../../../../src/host/tools/infrastructure/parent-tool-boundary.js"
import type { ParentToolDecision, ParentToolExecution } from "../../../../src/host/tools/infrastructure/parent-tool-boundary.js"
import { cleanupTempDirs, makeFlow, makeHarness, start } from "../../orchestrator/fixtures/harness.js"

afterEach(cleanupTempDirs)
class Pipeline {
  before?: (exec: ParentToolExecution, next: () => Promise<ParentToolDecision>) => Promise<ParentToolDecision>
  result?: (exec: ParentToolExecution, result: { isError?: unknown; error?: unknown }) => void
  guard?: (exec: ParentToolExecution) => string | undefined
  get(): unknown { return { guard: (guard: (exec: ParentToolExecution) => string | undefined) => { this.guard = guard; return () => { delete this.guard } } } }
  on(name: string, handler: unknown): () => void {
    if (name === "tools/pre-execute") { this.before = handler as NonNullable<Pipeline["before"]>; return () => { delete this.before } }
    this.result = handler as NonNullable<Pipeline["result"]>
    return () => { delete this.result }
  }
}

it("test_public_tool_pipeline_native_and_ptc_calls_cannot_override_monotonic_denial", async () => {
  const h = await makeHarness()
  await start(h, makeFlow())
  const pipeline = new Pipeline()
  const dispose = registerParentToolBoundary(pipeline, h.runtime)
  const exec = { agent: h.agents.roots.get("session-1"), name: "send_message", arguments: { target: "child" }, signal: new AbortController().signal }
  expect(await pipeline.before!(exec, async () => ({ kind: "allow" }))).toMatchObject({ kind: "deny", info: { code: "WF_PARENT_TOOL_DENIED" } })
  expect(pipeline.guard!({ ...exec, parent: "ptc-token" } as ParentToolExecution)).toContain("WF_PARENT_TOOL_DENIED")
  dispose()
  expect(pipeline.guard).toBeUndefined()
  expect(pipeline.before).toBeUndefined()
  expect(pipeline.result).toBeUndefined()
})

it("test_public_tool_pipeline_child_calls_leave_original_child_policy_in_charge", async () => {
  const h = await makeHarness()
  await start(h, makeFlow())
  const pipeline = new Pipeline()
  const dispose = registerParentToolBoundary(pipeline, h.runtime)
  const exec = { agent: { id: "child", session: { header: { origin: "subagent", parentSession: "session-1" } } }, name: "read", arguments: { path: "business" }, signal: new AbortController().signal }
  expect(await pipeline.before!(exec, async () => ({ kind: "allow" }))).toEqual({ kind: "allow" })
  expect(pipeline.guard!(exec)).toBeUndefined()
  dispose()
})

it("test_public_tool_result_message_only_plugin_code_is_audited", async () => {
  const h = await makeHarness()
  const { entry } = await start(h, makeFlow())
  const pipeline = new Pipeline()
  const dispose = registerParentToolBoundary(pipeline, h.runtime)
  const reports = vi.spyOn(h.runtime, "recordParentToolResult")
  pipeline.result!({ agent: h.agents.roots.get("session-1"), name: "wf_run_node", signal: new AbortController().signal }, { isError: true, error: { message: "WF_BAD_ARGS: nodeId: required; fields=[{field:nodeId}]" } })
  await reports.mock.results[0].value
  expect(entry.snapshot.parentFailures?.[0]).toMatchObject({ code: "WF_BAD_ARGS", message: expect.stringContaining("nodeId") })
  dispose()
})
