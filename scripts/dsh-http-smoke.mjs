import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const origin = process.env.DSH_BASE_URL ?? "http://127.0.0.1:3081"
const logPath = process.env.DSH_WEB_LOG
let token
if (logPath) {
  const log = await readFile(logPath, "utf8")
  token = log.match(/[?&]token=([^\s&]+)/)?.[1]
}
// Never print the generated login token, response cookies, or account settings.
const login = new URL("/", origin)
if (token) login.searchParams.set("token", token)
const response = await fetch(login, { redirect: "manual", signal: AbortSignal.timeout(10000) })
assert.ok(response.ok || response.status === 302 || response.status === 303, `boot HTTP ${response.status}`)
const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ")
const headers = { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }
const checks = []
for (const endpoint of ["toolCombos", "activeRuns"]) {
  const result = await fetch(new URL(`/visual-workflow/${endpoint}`, origin), { method: "POST", headers, body: JSON.stringify({ args: {} }), signal: AbortSignal.timeout(10000) })
  const json = await result.json()
  assert.equal(result.status, 200, `${endpoint} HTTP ${result.status}`)
  assert.equal(json.ok, true, `${endpoint} failed`)
  checks.push({ endpoint, httpStatus: result.status, ok: json.ok })
}
console.log(JSON.stringify({ status: "passed", bootHttpStatus: response.status, checks }))
