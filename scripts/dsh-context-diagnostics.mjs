// Read-only deployment evidence. Never emits prompt text, summaries or credentials.
import { createReadStream } from "node:fs"
import { readFile } from "node:fs/promises"
import { createInterface } from "node:readline"
import { createZstdDecompress } from "node:zlib"

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1])
const sessionPath = args.get("--session")
if (!sessionPath) throw new Error("Usage: node scripts/dsh-context-diagnostics.mjs --session <session.jsonl[.zstd]> [--inventory <pluginInventory.list.json>] [--runtime-log <dsh.log>]")
const wanted = new Set(["request/context", "compaction/start", "compaction/summary", "compaction/summary-error", "compaction/end", "turn/end"])
const safeError = (error) => ({
  ...(typeof error?.code === "string" ? { code: error.code } : {}),
  ...(typeof error?.message === "string" ? { message: error.message.replace(/(Bearer\s+|api[_-]?key[=:\s]+|token[=:\s]+)\S+/gi, "$1[redacted]").replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 600) } : {}),
})
const rows = []
let records = 0, previousSeq, firstSeq, lastSeq, sessionPreset, contiguous = true
let input = createReadStream(sessionPath)
if (sessionPath.endsWith(".zstd") || sessionPath.endsWith(".zst")) input = input.pipe(createZstdDecompress())
for await (const line of createInterface({ input, crlfDelay: Infinity })) {
  if (!line.trim()) continue
  const event = JSON.parse(line)
  if (typeof event.type !== "string") continue
  if (event.type === "session" && typeof event.agentPreset === "string") sessionPreset = event.agentPreset
  records++
  if (Number.isInteger(event.seq)) {
    firstSeq ??= event.seq
    if (previousSeq !== undefined && event.seq !== previousSeq + 1) contiguous = false
    previousSeq = lastSeq = event.seq
  }
  if (!wanted.has(event.type)) continue
  const data = event.data ?? {}
  const row = { type: event.type, seq: event.seq, time: event.time }
  if (event.type === "request/context") Object.assign(row, { provider: data.provider, model: data.model, contextWindow: data.contextWindow ?? "unknown" })
  if (event.type.startsWith("compaction/")) {
    for (const key of ["compactionId", "provider", "model", "trigger", "shadowedTokenCount", "inputTokens", "outputTokens", "kind", "status"]) if (["string", "number", "boolean"].includes(typeof data[key])) row[key] = data[key]
    if (data.error) row.error = safeError(data.error)
  }
  if (event.type === "turn/end") Object.assign(row, { kind: data.reason?.kind, ...(data.reason?.error ? { error: safeError(data.reason.error) } : {}) })
  rows.push(row)
}
const pluginNames = ["@deepseek-ai/dsh-token-meter", "@deepseek-ai/dsh-compaction-basic", "@deepseek-ai/dsh-compaction-tool-result-pruner"]
let inventory
if (args.has("--inventory")) inventory = JSON.parse(await readFile(args.get("--inventory"), "utf8"))
const snapshot = inventory?.value ?? inventory
const presetId = args.get("--preset") ?? sessionPreset
const plugins = pluginNames.map((moduleName) => {
  const entries = (snapshot?.entries ?? []).filter((entry) => entry.moduleName === moduleName)
  const presets = (snapshot?.agentPresets ?? []).filter((preset) => preset.id === presetId).flatMap((preset) => (preset.rows ?? []).filter((entry) => entry.moduleName === moduleName).map((entry) => ({ ...entry, presetId: preset.id })))
  const active = [...entries, ...presets].some((entry) => entry.enabled === true && entry.fiberPhase === "active")
  return { moduleName, loaded: active ? true : snapshot && (presetId || !snapshot.agentPresets?.length) ? false : "unknown", entries: [...entries, ...presets].map(({ entryId, enabled, fiberPhase, presetId }) => ({ entryId, enabled, fiberPhase, presetId })) }
})
const warnings = []
if (args.has("--runtime-log")) {
  let number = 0
  for await (const line of createInterface({ input: createReadStream(args.get("--runtime-log")), crlfDelay: Infinity })) {
    number++
    const match = line.match(/(?:step compaction failed|context-overflow compaction failed(?: after durable surface progress)?): (.*)/)
    if (match) warnings.push({ line: number, ...safeError({ message: match[0] }) })
  }
}
const contexts = rows.filter((row) => row.type === "request/context")
const starts = rows.filter((row) => row.type === "compaction/start")
console.log(JSON.stringify({
  source: sessionPath, coverage: { records, firstSeq, lastSeq, contiguous }, actualRoutes: contexts,
  presetId: presetId ?? "unknown", plugins, compactionStartedInProvidedLog: starts.length, events: rows, compactionWarnings: warnings,
  pending: [
    ...(!contexts.length ? ["实际 provider/model/contextWindow 未记录，需部署取证；不根据工作流配置猜测实际请求。"] : []),
    ...(!inventory ? ["缺当前运行的 pluginInventory.list 结果，实际插件加载状态待部署核验；安装或配置声明不等于已加载。"] : []),
    "inventory 是当前时点证据，不能证明历史故障当时的插件状态。",
    "无 compaction/start 只表示所给日志中未观测到；需核对日志完整性和会话。",
    "compaction/summary-error 在官方 0.2.0-rc.2 是恢复瀑布钩子，不保证持久化为会话事件；同时检查官方压缩警告日志。",
    "窗口错误不单独证明压缩根因；需联合摘要错误、压缩结束、重试和最终 turn/end 判断。",
  ],
}, null, 2))
