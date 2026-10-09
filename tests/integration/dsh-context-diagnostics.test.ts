import { afterEach, expect, it } from "vitest"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { zstdCompressSync } from "node:zlib"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

it("test_readonly_diagnostics_extract_official_context_and_failure_from_zstd_without_message_content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vw-diagnostics-"))
  directories.push(dir)
  const path = join(dir, "session.v4.jsonl.zstd")
  const log = [
    { type: "session", version: 4, id: "historical-session", agentPreset: "standard" },
    { seq: 0, type: "request/context", data: { provider: "actual-provider", model: "actual-model", contextWindow: 32000 } },
    { seq: 1, type: "user/message", data: { content: [{ type: "text", text: "PRIVATE_USER_TEXT" }] } },
    { seq: 2, type: "compaction/start", data: { compactionId: "c1" } },
    { seq: 3, type: "compaction/summary", data: { summary: "PRIVATE_SUMMARY", rawOutput: "PRIVATE_RAW_OUTPUT", provider: "summary-provider", model: "summary-model" } },
    { seq: 4, type: "compaction/end", data: { compactionId: "c1" } },
    { seq: 5, type: "turn/end", data: { reason: { kind: "error", error: { code: "CONTEXT_WINDOW_EXCEEDED", message: "400 status code (no body)" } } } },
  ].map((event) => JSON.stringify(event)).join("\n")
  await writeFile(path, zstdCompressSync(Buffer.from(log)))
  const inventory = join(dir, "inventory.json")
  await writeFile(inventory, JSON.stringify({ entries: [{ moduleName: "@deepseek-ai/dsh-token-meter", enabled: true, fiberPhase: "active" }], agentPresets: [{ id: "standard", rows: [{ moduleName: "@deepseek-ai/dsh-compaction-basic", enabled: true, fiberPhase: "active" }] }] }))
  const before = await stat(path)
  const bytes = await readFile(path)
  const { stdout } = await promisify(execFile)(process.execPath, ["scripts/dsh-context-diagnostics.mjs", "--session", path, "--inventory", inventory])
  const report = JSON.parse(stdout)
  expect(report.actualRoutes).toEqual([expect.objectContaining({ provider: "actual-provider", model: "actual-model", contextWindow: 32000 })])
  expect(report.events.at(-1)).toMatchObject({ kind: "error", error: { code: "CONTEXT_WINDOW_EXCEEDED", message: "400 status code (no body)" } })
  expect(report.plugins.map((plugin: { loaded: boolean }) => plugin.loaded)).toEqual([true, true, false])
  expect(report.compactionStartedInProvidedLog).toBe(1)
  expect(stdout).not.toMatch(/PRIVATE_USER_TEXT|PRIVATE_SUMMARY|PRIVATE_RAW_OUTPUT/)
  expect(await readFile(path)).toEqual(bytes)
  expect((await stat(path)).mtimeMs).toBe(before.mtimeMs)
})

it("test_missing_deployment_evidence_remains_unknown_instead_of_inventing_a_route_or_window", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vw-diagnostics-"))
  directories.push(dir)
  const path = join(dir, "session.jsonl")
  await writeFile(path, JSON.stringify({ type: "turn/end", seq: 166, data: { reason: { kind: "error", error: { code: "CONTEXT_WINDOW_EXCEEDED", message: "400 status code (no body)" } } } }))
  const { stdout } = await promisify(execFile)(process.execPath, ["scripts/dsh-context-diagnostics.mjs", "--session", path])
  const report = JSON.parse(stdout)
  expect(report.actualRoutes).toEqual([])
  expect(report.plugins.every((plugin: { loaded: string }) => plugin.loaded === "unknown")).toBe(true)
  expect(report.events[0].error.code).toBe("CONTEXT_WINDOW_EXCEEDED")
  expect(report.pending.join("\n")).toContain("待部署核验")
})
