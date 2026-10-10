import { afterEach, expect, it } from "vitest"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { runtimeInputsOf } from "../../../src/host/orchestrator/runtime-inputs.js"
import { cleanupTempDirs, makeFlow, makeHarness } from "./fixtures/harness.js"

afterEach(cleanupTempDirs)

it("test_workspace_and_managed_files_without_file_node_authorize_explicit_paths", async () => {
  const h = await makeHarness()
  await mkdir(join(h.dir, "data", "files"), { recursive: true })
  await writeFile(join(h.dir, "input.txt"), "one")
  await writeFile(join(h.dir, "data", "files", "input.txt"), "two")
  const result = await runtimeInputsOf({ workflowInputs: { document: [{ kind: "file", fileRef: { source: "workspace", path: "input.txt" } }, { kind: "file", fileRef: { source: "managed", path: "data/files/input.txt" } }] } }, makeFlow(), { cwd: h.dir, managedRoot: h.dir, files: [] })
  expect(result.workflowInputs.document).toMatchObject([{ fileRef: { path: join(h.dir, "input.txt") } }, { fileRef: { path: join(h.dir, "data", "files", "input.txt") } }])
})

it("test_attachment_reference_uses_host_path_and_rejects_metadata_forgery", async () => {
  const h = await makeHarness()
  const path = join(h.dir, "attachment.txt")
  await writeFile(path, "safe")
  const file = { attachmentId: "official-1", name: "attachment.txt", bytes: 4, path }
  const access = { managedRoot: h.dir, files: [file] }
  const raw = { workflowInputs: { document: [{ kind: "file", fileRef: { source: "attachment", ...file, path: "/forged" } }] } }
  expect((await runtimeInputsOf(raw, makeFlow(), access)).workflowInputs.document[0]).toMatchObject({ fileRef: { path } })
  raw.workflowInputs.document[0].fileRef.bytes = 5
  await expect(runtimeInputsOf(raw, makeFlow(), access)).rejects.toMatchObject({ code: "WF_INPUT_FILE_UNAUTHORIZED" })
})

it("test_workspace_symlink_outside_scope_is_denied", async () => {
  const h = await makeHarness()
  await mkdir(join(h.dir, "workspace"))
  await writeFile(join(h.dir, "outside.txt"), "outside")
  await symlink(join(h.dir, "outside.txt"), join(h.dir, "workspace", "link.txt"))
  await expect(runtimeInputsOf({ workflowInputs: { document: [{ kind: "file", fileRef: { source: "workspace", path: "link.txt" } }] } }, makeFlow(), { cwd: join(h.dir, "workspace"), managedRoot: h.dir, files: [] })).rejects.toMatchObject({ code: "WF_INPUT_FILE_UNAUTHORIZED" })
})

it.each([NaN, undefined, new Date(), { constructor: "unsafe" }, Array(1).fill(undefined)])("test_json_invalid_value_reports_stable_field_error_%s", async (value) => {
  await expect(runtimeInputsOf({ workflowInputs: { facts: [{ kind: "json", value }] } }, makeFlow(), { managedRoot: "/tmp", files: [] })).rejects.toMatchObject({ code: "WF_RUNTIME_INPUT_INVALID", details: expect.any(Array) })
})

it("test_cyclic_json_and_duplicate_proxy_bindings_are_rejected", async () => {
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  const access = { managedRoot: "/tmp", files: [] }
  await expect(runtimeInputsOf({ parameters: cyclic }, makeFlow(), access)).rejects.toMatchObject({ code: "WF_RUNTIME_INPUT_INVALID" })
  await expect(runtimeInputsOf({ nodeInputs: { "n-a2": {}, "n-proxy-a2": {} } }, makeFlow(), access)).rejects.toMatchObject({ code: "WF_RUNTIME_INPUT_INVALID" })
})
