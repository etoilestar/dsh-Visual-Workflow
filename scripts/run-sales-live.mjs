// Live DSH acceptance, using configured model credentials in the DSH host.
// This script creates a reviewable test session/flow, never approves experience cards.
import assert from "node:assert/strict"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const provider = process.env.DSH_TEST_PROVIDER
const model = process.env.DSH_TEST_MODEL
const prepareOnly = process.argv.includes("--prepare-only")
assert.ok(prepareOnly || (provider && model), "Set DSH_TEST_PROVIDER and DSH_TEST_MODEL to configured DSH routing names; credentials remain in DSH settings")
const workspace = resolve(process.env.DSH_TEST_WORKSPACE ?? `/workspace/.cloud-env/sales-live-${Date.now()}`)
const sourceCsv = resolve(process.env.SALES_CSV ?? fileURLToPath(new URL("../tests/fixtures/sales_workflow_test.csv", import.meta.url)))
await readFile(sourceCsv, "utf8") // actual input must be readable in the same host filesystem
await mkdir(workspace, { recursive: true })
await mkdir(resolve(workspace, "output"), { recursive: true })
const csv = resolve(workspace, "sales_workflow_test.csv")
if (sourceCsv !== csv) await copyFile(sourceCsv, csv)
const origin = process.env.DSH_BASE_URL ?? "http://127.0.0.1:3081"
const login = new URL("/", origin)
const token = process.env.DSH_WEB_LOG ? (await readFile(process.env.DSH_WEB_LOG, "utf8")).match(/[?&]token=([^\s&]+)/)?.[1] : undefined
if (token) login.searchParams.set("token", token)
const response = await fetch(login, { redirect: "manual", signal: AbortSignal.timeout(10000) })
assert.ok(response.ok || [302, 303].includes(response.status), `boot HTTP ${response.status}`)
const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ")
const headers = { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }
async function api(endpoint, args) {
  const response = await fetch(new URL(`/visual-workflow/${endpoint}`, origin), { method: "POST", headers, body: JSON.stringify({ args }), signal: AbortSignal.timeout(30000) })
  const result = await response.json()
  if (!response.ok || result.ok !== true) throw new Error(`${endpoint}: ${result.error?.code ?? response.status}`)
  return result.value
}
const created = await api("createSession", { workspacePath: workspace, label: "销售 CSV 真实验收" })
const sessionId = created.sessionId
assert.ok(typeof sessionId === "string", "createSession did not return sessionId")
const ids = ["load_data", "quality_check", "sales_stats", "summary_gen", "report_gen"]
const outputs = ["raw.json", "quality.json", "stats.json", "summary.md", "final_report.md"].map((name) => resolve(workspace, "output", name))
const tasks = [
  `实际使用 read 读取 ctx 给出的 CSV 路径，按表头解析全部记录（保留重复行与空单元格），写 JSON 记录数组到 ${outputs[0]}。最终回复准确给出该文件绝对路径。`,
  `实际读取上游 JSON 文件，统计原始记录数、完全重复记录数、空单元格数；去重并剔除任何有缺失单元格的记录，保留有效记录。写 JSON {records,duplicates,missingCells,valid:[记录对象]} 到 ${outputs[1]}。最终回复准确给出文件绝对路径。`,
  `实际读取上游质量 JSON，以有效记录 sales_amount 计算统计。写 JSON {records,duplicates,missingCells,valid:有效记录数,total,average:两位小数字符串,maximum:{id:order_id,amount},minimum:{id:order_id,amount}} 到 ${outputs[2]}。最终回复准确给出文件绝对路径。`,
  `实际读取上游统计 JSON，生成中文销售摘要，明确所有数量、总额、平均额、最大和最小记录及订单号；写入 ${outputs[3]}，最终回复准确给出文件绝对路径。`,
  `实际读取上游摘要，生成完整中文 Markdown 销售报告，保留全部统计及去重/缺失值处理说明；写入 ${outputs[4]}，最终回复准确给出文件绝对路径。`,
]
const role = (id, kind, systemPrompt, execution) => ({ id, kind, position: { x: 0, y: 0 }, data: { label: id, systemPrompt, provider: provider ?? "", model: model ?? "", presetId: "standard", retryLimit: 2, reactLimit: 50, inputSchema: "", outputSchema: "", ...(execution ? { execution } : {}) } })
const flowId = `sales-live-${Date.now()}`
const flow = {
  id: flowId, sessionId, mode: "mode1", revision: 0, name: "销售 CSV 真实验收", description: "用户提供的 11 行 CSV；通过文件节点绑定输入，所有交接显式走 ctx。",
  nodes: [
    { id: "start", kind: "start", position: { x: 0, y: 0 }, data: { label: "启动" } },
    role("parent", "parent", "你是编排父代理。只按流程调度五个业务子代理，等待其实际完成后调度下游，不代替它们执行数据任务。核对节点状态和报告文件后调用 wf_finish；节点失败须如实处理并报告。"),
    ...ids.map((id, index) => role(id, "agent", tasks[index], { inputSource: "ctx", requiredTools: ["read", "write"], outputFiles: [outputs[index]] })),
    { id: "end", kind: "end", position: { x: 0, y: 0 }, data: { label: "结束" } },
    { id: "csv", kind: "file", position: { x: 0, y: 0 }, data: { label: "销售 CSV 输入", fileKind: "file" } },
  ],
  lines: [],
}
const chain = ["start", ...ids, "end"]
flow.lines.push(...chain.slice(1).map((target, index) => ({ id: `flow-${index}`, source: chain[index], target, sourceHandle: "flow-out", targetHandle: "flow-in" })))
flow.lines.push(...["csv", ...ids.slice(0, -1)].map((source, index) => ({ id: `ctx-${index}`, source, target: ids[index], sourceHandle: "ctx-out", targetHandle: "ctx-in" })))
await writeFile(resolve(workspace, "live-flow.json"), JSON.stringify(flow, null, 2))
await api("putWorkflow", { sessionId, flow })
if (prepareOnly) {
  console.log(JSON.stringify({ status: "prepared", sessionId, flowId, workspace, modelRunStarted: false }))
  process.exit(0)
}
const { runId } = await api("run", { sessionId, flowId, fileBindings: { csv: [csv] } })
console.log(JSON.stringify({ phase: "started", runId, sessionId, flowId, provider, model, workspace }))
const deadline = Date.now() + Number(process.env.DSH_TEST_TIMEOUT_MS ?? 600000)
let snapshot
let progress = ""
while (Date.now() < deadline) {
  snapshot = await api("runStatus", { sessionId, runId })
  const state = JSON.stringify({ status: snapshot.status, nodes: snapshot.nodes.filter((node) => ids.includes(node.nodeId)).map(({ nodeId, status, attempts }) => ({ nodeId, status, attempts })) })
  if (state !== progress) { console.log(state); progress = state }
  if (!["running", "paused"].includes(snapshot.status)) break
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
await writeFile(resolve(workspace, "live-run.json"), JSON.stringify(snapshot, null, 2))
if (!snapshot || ["running", "paused"].includes(snapshot.status)) {
  await api("runStop", { sessionId, runId })
  throw new Error(`Live acceptance timed out; stopped owned test run ${runId}`)
}
assert.equal(snapshot.status, "completed", `run ${runId}: ${snapshot.status}; inspect live-run.json and DSH session errors`)
for (const id of ids) {
  const node = snapshot.nodes.find((node) => node.nodeId === id)
  assert.equal(node?.status, "ok", `${id} did not complete`)
  assert.ok(node.childId && node.attempts > 0 && node.provider && node.model && node.artifacts?.length, `${id} lacks actual child/route/artifact evidence`)
}
assert.ok(snapshot.parentRoute?.provider && snapshot.parentRoute?.model, "parent model route was not recorded")
const stats = JSON.parse(await readFile(outputs[2], "utf8"))
assert.deepEqual(stats, { records: 11, duplicates: 1, missingCells: 2, valid: 9, total: 15900, average: "1766.67", maximum: { id: "S001", amount: 6000 }, minimum: { id: "S010", amount: 200 } })
const report = await readFile(outputs[4], "utf8")
for (const value of ["15900", "1766.67", "6000", "S001", "200", "S010"]) assert.ok(report.includes(value), `report missing ${value}`)
console.log(JSON.stringify({ status: "passed", runId, businessNodes: 5, report: outputs[4] }))
