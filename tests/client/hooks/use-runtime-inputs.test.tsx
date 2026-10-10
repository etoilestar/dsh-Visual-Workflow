// @vitest-environment jsdom
import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { useRuntimeInputs, type RuntimeInputSelection } from "../../../src/client/hooks/use-runtime-inputs.js"
import { useRunControl } from "../../../src/client/hooks/useRunControl.js"
import { zh } from "../../../src/client/i18n.js"
import { EP } from "../../../src/client/lib/remote.js"
import type { RemoteFace } from "../../../src/client/hooks/useRemote.js"
import type { RuntimeInputOptions } from "../../../src/host/shared/runtime-types.js"

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let container: HTMLDivElement | undefined
let face!: { inputs: ReturnType<typeof useRuntimeInputs>; control: ReturnType<typeof useRunControl> }
const options: RuntimeInputOptions = { workflowInputs: { subject: { kind: "text" } }, nodeInputs: { workflow: {}, first: {} }, files: [{ attachmentId: "att", name: "data.csv", bytes: 4, path: "/host/data.csv" }], handoffPolicy: "explicit", workingDirectory: "/work" }
const checkpoint = { id: "run", flowId: "flow", inputRevision: 3, handoffPolicy: "auto", runtimeInputs: { workflowInputs: { subject: [{ kind: "text", value: "saved" }] }, nodeInputs: { first: { old: [{ kind: "json", value: { count: 2 } }] } }, parameters: { limit: 4 } }, nodes: [{ nodeId: "first", status: "pending", attempts: 0 }, { nodeId: "workflow", status: "running", attempts: 1 }] }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
async function render(remote: RemoteFace, owner = "session:flow", dispatch = vi.fn()) {
  function Harness({ owner }: { owner: string }) {
    const inputs = useRuntimeInputs(remote, zh, owner)
    const control = useRunControl(dispatch, remote, inputs.prepare, inputs.lifecycle)
    useEffect(() => { face = { inputs, control } })
    return null
  }
  container = document.createElement("div"); document.body.append(container)
  root = createRoot(container)
  const rerender = async (owner: string) => { await act(async () => { root!.render(<Harness owner={owner} />) }) }
  await rerender(owner)
  return { rerender, dispatch }
}
function remoteOf(extra: (endpoint: string, args: unknown) => unknown = () => null): RemoteFace {
  return { call: vi.fn(async (endpoint: string, args: unknown) => endpoint === EP.EP_RUNTIME_INPUT_OPTIONS ? structuredClone(options) : endpoint === EP.EP_RUN_STATUS ? structuredClone(checkpoint) : extra(endpoint, args)) } as unknown as RemoteFace
}
async function prepare(runId?: string, binding = false) {
  let pending!: Promise<RuntimeInputSelection | null>
  await act(async () => { pending = face.inputs.prepare("session", "flow", runId, binding) })
  return { pending }
}
afterEach(async () => { await act(async () => { root?.unmount() }); root = undefined; container?.remove(); vi.restoreAllMocks() })

it("test_start_missing_required_input_keeps_dialog_and_does_not_run", async () => {
  const remote = remoteOf()
  await render(remote)
  let started!: Promise<string | null>
  await act(async () => { started = face.control.startRun("session", "flow") })
  await act(async () => { await face.inputs.submit() })
  expect(face.inputs.dialog?.error).toContain("subject")
  expect(vi.mocked(remote.call).mock.calls.map(([name]) => name)).toEqual([EP.EP_RUNTIME_INPUT_OPTIONS])
  await act(async () => { face.inputs.cancel() })
  expect(await started).toBeNull()
})

it("test_start_typed_inputs_and_policy_are_sent_without_ui_generation", async () => {
  const remote = remoteOf(() => ({ runId: "started", sessionId: "session" }))
  const { dispatch } = await render(remote)
  let started!: Promise<string | null>
  await act(async () => { started = face.control.startRun("session", "flow") })
  await act(async () => { face.inputs.add("workflow", "subject", "text", "topic"); face.inputs.add("node:workflow", "payload", "json", '{"ok":true}'); face.inputs.change({ handoffPolicy: "auto", parametersText: '{"limit":5}' }) })
  await act(async () => { await face.inputs.submit(); await started })
  expect(vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_RUN)?.[1]).toEqual({ sessionId: "session", flowId: "flow", handoffPolicy: "auto", runtimeInputs: { workflowInputs: { subject: [{ kind: "text", value: "topic" }] }, nodeInputs: { workflow: { payload: [{ kind: "json", value: { ok: true } }] } }, parameters: { limit: 5 } } })
  expect(dispatch).toHaveBeenCalledWith({ type: "RUN_STARTED", runId: "started", runSessionId: "session" })
})

it("test_resume_explicit_checkpoint_restores_inputs_and_policy", async () => {
  await render(remoteOf())
  const { pending } = await prepare("run")
  expect(face.inputs.dialog).toMatchObject({ inputs: checkpoint.runtimeInputs, handoffPolicy: "auto", parametersText: '{\n  "limit": 4\n}' })
  await act(async () => { await face.inputs.submit() })
  expect(await pending).toMatchObject({ runtimeInputs: checkpoint.runtimeInputs, handoffPolicy: "auto" })
})

it("test_bind_pending_node_sends_exact_revision_and_node_slots", async () => {
  const remote = remoteOf()
  await render(remote)
  const { pending } = await prepare("run", true)
  expect(face.inputs.dialog?.eligibleNodes).toEqual(["first"])
  await act(async () => { face.inputs.add("node:first", "data", "attachment", "att") })
  await act(async () => { await face.inputs.submit() })
  expect(vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_RUN_INPUT_BIND)?.[1]).toEqual({ sessionId: "session", runId: "run", nodeId: "first", expectedRevision: 3, inputs: { old: [{ kind: "json", value: { count: 2 } }], data: [{ kind: "file", fileRef: { source: "attachment", attachmentId: "att", name: "data.csv", bytes: 4 } }] } })
  expect((await pending)?.runtimeInputs.nodeInputs.first.data?.[0]).toMatchObject({ kind: "file" })
})

it("test_bind_revision_conflict_refreshes_revision_and_requires_review", async () => {
  const remote = remoteOf(() => { throw Object.assign(new Error("conflict"), { code: "WF_INPUT_REVISION_CONFLICT" }) })
  await render(remote)
  const { pending } = await prepare("run", true)
  vi.mocked(remote.call).mockImplementationOnce(async () => { throw Object.assign(new Error("conflict"), { code: "WF_INPUT_REVISION_CONFLICT" }) }).mockImplementationOnce(async () => ({ ...checkpoint, inputRevision: 4 }))
  await act(async () => { await face.inputs.submit() })
  expect(face.inputs.dialog).toMatchObject({ revision: 4, busy: false, error: zh.runtimeRevisionChanged })
  expect(vi.mocked(remote.call).mock.calls.filter(([name]) => name === EP.EP_RUN_INPUT_BIND)).toHaveLength(1)
  await act(async () => { face.inputs.cancel() })
  expect(await pending).toBeNull()
})

it("test_upload_managed_file_stays_draft_until_explicit_binding", async () => {
  const remote = remoteOf(() => ({ managedPath: "/store/data/files/unique.csv" }))
  await render(remote)
  const { pending } = await prepare("run", true)
  await act(async () => { await face.inputs.upload("node:first", "source", new File(["data"], "data.csv")) })
  const upload = vi.mocked(remote.call).mock.calls.find(([name]) => name === EP.EP_FILE_UPLOAD)?.[1] as { name: string; base64: string }
  expect(upload.name).toMatch(/^[a-f0-9-]+-data\.csv$/)
  expect(upload.base64).toBe("ZGF0YQ==")
  expect(face.inputs.dialog?.inputs.nodeInputs.first.source).toEqual([{ kind: "file", fileRef: { source: "managed", path: "/store/data/files/unique.csv" } }])
  expect(vi.mocked(remote.call).mock.calls.some(([name]) => name === EP.EP_RUN_INPUT_BIND)).toBe(false)
  await act(async () => { face.inputs.cancel() })
  expect(await pending).toBeNull()
})

it("test_edit_invalid_slot_json_and_removal_are_diagnosed", async () => {
  await render(remoteOf())
  const { pending } = await prepare()
  await act(async () => { face.inputs.add("workflow", "__proto__", "text", "bad") })
  expect(face.inputs.dialog?.error).toContain(zh.runtimeInvalidSlot)
  await act(async () => { face.inputs.add("workflow", "data", "json", "broken") })
  expect(face.inputs.dialog?.error).toContain(zh.runtimeInvalidValue)
  await act(async () => { face.inputs.add("workflow", "subject", "workspace", "input.csv"); face.inputs.remove("workflow", "subject") })
  expect(face.inputs.dialog?.inputs.workflowInputs).toEqual({})
  await act(async () => { face.inputs.cancel() }); expect(await pending).toBeNull()
})

it("test_owner_change_cancels_pending_input_selection", async () => {
  const { rerender } = await render(remoteOf())
  const { pending } = await prepare()
  await rerender("session:other")
  expect(await pending).toBeNull()
  expect(face.inputs.dialog).toBeNull()
})

it("test_template_instance_transition_preserves_requested_dialog", async () => {
  const { rerender } = await render(remoteOf(), "session:template")
  const { pending } = await prepare()
  await rerender("session:flow")
  expect(face.inputs.dialog?.flowId).toBe("flow")
  await act(async () => { face.inputs.cancel() }); expect(await pending).toBeNull()
})

it("test_late_start_response_after_document_change_does_not_patch_new_document", async () => {
  const gate = deferred<{ runId: string }>()
  const { rerender, dispatch } = await render(remoteOf(() => gate.promise))
  let pending!: Promise<string | null>
  await act(async () => { pending = face.control.startRun("session", "flow") })
  await act(async () => { face.inputs.add("workflow", "subject", "text", "topic"); await face.inputs.submit() })
  await rerender("session:other")
  gate.resolve({ runId: "old" })
  expect(await pending).toBeNull()
  expect(dispatch).not.toHaveBeenCalled()
})

it("test_unmount_during_input_options_ignores_late_result", async () => {
  const gate = deferred<RuntimeInputOptions>()
  await render({ call: vi.fn(() => gate.promise) } as unknown as RemoteFace)
  let pending!: Promise<RuntimeInputSelection | null>
  await act(async () => { pending = face.inputs.prepare("session", "flow") })
  await act(async () => { root!.unmount() }); root = undefined
  gate.resolve(options)
  expect(await pending).toBeNull()
})
