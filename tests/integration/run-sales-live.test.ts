// Controlled HTTP boundary checks for the live acceptance script, not model E2E.
import { afterEach, expect, it } from "vitest"
import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

const execute = promisify(execFile)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())) })

it("test_sales_live_help_and_missing_configuration_never_start_a_run", async () => {
  const env = { ...process.env, DSH_BASE_URL: "", DSH_TEST_PROVIDER: "", DSH_TEST_MODEL: "", DSH_WEB_LOG: "" }
  const { stdout } = await execute(process.execPath, ["scripts/run-sales-live.mjs", "--help"], { env })
  expect(stdout).toContain("DSH_BASE_URL")
  expect(stdout).toContain("DSH_TEST_PROVIDER")
  expect(stdout).toContain("DSH_TEST_MODEL")
  await expect(execute(process.execPath, ["scripts/run-sales-live.mjs"], { env })).rejects.toMatchObject({ stderr: expect.stringContaining("Set DSH_BASE_URL") })
})

it.each([true, false])("test_sales_live_configurable_http_boundary_prepare_%s_keeps_route_and_rejects_missing_child_evidence", async (prepareOnly) => {
  const workspace = await mkdtemp(join(tmpdir(), "sales-script-test-"))
  cleanups.push(() => rm(workspace, { recursive: true, force: true }))
  const requests: Array<{ endpoint: string; args: Record<string, unknown> }> = []
  const server = createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += String(chunk)
    const endpoint = request.url!.split("/").at(-1)!
    if (request.method === "GET") { response.end("ready"); return }
    const { args } = JSON.parse(body)
    requests.push({ endpoint, args })
    const values: Record<string, unknown> = {
      createSession: { sessionId: "controlled-session" }, putWorkflow: {}, run: { runId: "controlled-run" },
      runStatus: { status: "completed", nodes: ["load_data", "quality_check", "sales_stats", "summary_gen", "report_gen"].map((nodeId) => ({ nodeId, status: "ok" })) },
    }
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({ ok: true, value: values[endpoint] }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const port = (server.address() as { port: number }).port
  const env = { ...process.env, DSH_BASE_URL: `http://127.0.0.1:${port}`, DSH_TEST_PROVIDER: "site-specific-provider", DSH_TEST_MODEL: "site-specific-model", DSH_TEST_WORKSPACE: workspace, DSH_WEB_LOG: "", SALES_CSV: join(process.cwd(), "tests/fixtures/sales_workflow_test.csv"), DSH_TEST_TIMEOUT_MS: "1000" }
  const result = execute(process.execPath, ["scripts/run-sales-live.mjs", ...prepareOnly ? ["--prepare-only"] : []], { env })
  if (prepareOnly) {
    const { stdout } = await result
    expect(JSON.parse(stdout)).toMatchObject({ status: "prepared", modelRunStarted: false, workspace })
    expect(requests.map(({ endpoint }) => endpoint)).toEqual(["createSession", "putWorkflow"])
  } else {
    await expect(result).rejects.toMatchObject({ stderr: expect.stringContaining("load_data lacks actual child/route/artifact evidence") })
    expect(JSON.parse(await readFile(join(workspace, "live-run.json"), "utf8")).status).toBe("completed")
  }
  const flow = requests.find(({ endpoint }) => endpoint === "putWorkflow")!.args.flow as { mode: string; nodes: Array<{ kind: string; data: { provider: string; model: string; presetId: string; execution?: { requiredTools: string[] } } }> }
  expect(flow.mode).toBe("mode1")
  const nodes = flow.nodes.filter(({ kind }) => kind === "agent")
  expect(nodes).toHaveLength(5)
  for (const { data } of nodes) {
    expect(data).toMatchObject({ provider: "site-specific-provider", model: "site-specific-model", presetId: "standard", execution: { requiredTools: ["read", "write"] } })
  }
  expect(await readFile(join(workspace, "sales_workflow_test.csv"), "utf8")).toBe(await readFile(env.SALES_CSV, "utf8"))
})
