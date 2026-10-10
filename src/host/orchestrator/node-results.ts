import type { RoleNode } from "../shared/graph-model.js"
import type { JsonValue, NodeResult, ResultSchema } from "../shared/runtime-types.js"
import type { RunSnapshot } from "../shared/types.js"
import { executionOf } from "./execution-inputs.js"
import { WfError } from "./errors.js"
import { jsonValueOf } from "./runtime-inputs.js"
import { truncateText } from "./snapshot.js"

function invalid(field: string, message: string): never {
  throw new WfError(`${field}: ${message}`, "WF_OUTPUT_INVALID", { phase: "run_finish", retryable: false, details: [{ field, message }] })
}

export function validateResultSchema(value: JsonValue, schema: ResultSchema, field: string): void {
  const correct = schema.type === "null" ? value === null : schema.type === "array" ? Array.isArray(value) : schema.type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value) : schema.type === "integer" ? typeof value === "number" && Number.isSafeInteger(value) : typeof value === schema.type
  if (!correct) invalid(field, `需要 ${schema.type}`)
  if (schema.enum && !schema.enum.some((candidate) => candidate === value)) invalid(field, "不在枚举取值内")
  if (typeof value === "string" && schema.minLength !== undefined && value.length < schema.minLength) invalid(field, "文本长度不足")
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) invalid(field, "小于最小值")
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) invalid(field, "数组项目不足")
    if (schema.items) value.forEach((item, index) => validateResultSchema(item, schema.items!, `${field}[${index}]`))
  } else if (value !== null && typeof value === "object") {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) invalid(`${field}.${key}`, "必需字段缺失")
    for (const [key, part] of Object.entries(value)) {
      const child = schema.properties?.[key]
      if (child) validateResultSchema(part, child, `${field}.${key}`)
      else if (schema.additionalProperties === false) invalid(`${field}.${key}`, "不允许额外字段")
    }
  }
}

export function buildNodeResult(node: RoleNode, snapshot: RunSnapshot, text: string, childId?: string, fullLimit = 102400): NodeResult {
  const contract = executionOf(node)
  const record = snapshot.nodes.find((record) => record.nodeId === node.id)
  if (!record) invalid(node.id, "执行记录缺失")
  const result: NodeResult = { status: "succeeded", confirmation: "turn", runId: snapshot.id, nodeId: node.id, attempt: record.attempts, ...(childId === undefined ? {} : { childId }), outputs: {}, artifacts: structuredClone(record.artifacts ?? []) }
  if (contract.completion === "semantic") throw new WfError("语义完成条件未经宿主确认；回合结束不能证明业务成功", "WF_OUTPUT_UNCONFIRMED", { phase: "run_finish", retryable: false })
  const names = Object.entries(contract.outputs ?? {}).filter(([, output]) => output.kind !== "file")
  let parsed: unknown
  if (names.length) { try { parsed = JSON.parse(text) } catch { parsed = undefined } }
  const envelope = parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.hasOwn(parsed, "outputs") ? (parsed as { outputs: unknown }).outputs : undefined
  for (const [name, output] of names) {
    const named = envelope !== null && typeof envelope === "object" && !Array.isArray(envelope) && Object.hasOwn(envelope, name)
    const value = named ? (envelope as Record<string, unknown>)[name] : names.length === 1 && envelope === undefined ? output.kind === "text" ? text : parsed : undefined
    if (value === undefined) { if (output.required !== false) invalid(`outputs.${name}`, "必需输出缺失"); continue }
    if (output.kind === "text" && (typeof value !== "string" || output.required !== false && !value.trim())) invalid(`outputs.${name}`, "需要非空文本")
    let json: JsonValue
    try { json = jsonValueOf(value, `outputs.${name}`) } catch { invalid(`outputs.${name}`, "需要有效 JSON") }
    if (output.schema) validateResultSchema(json, output.schema, `outputs.${name}`)
    result.outputs[name] = json
  }
  if (!names.length && text.trim()) result.outputs.response = truncateText(text, fullLimit)
  const hardContract = names.length > 0 || (contract.outputFiles?.length ?? 0) > 0 || Object.values(contract.outputs ?? {}).some((output) => output.kind === "file") || contract.completion === "verified"
  if (contract.completion === "verified" && !Object.keys(result.outputs).length && !result.artifacts.length) invalid("outputs", "没有可以确认的结果")
  result.confirmation = hardContract ? "verified" : "turn"
  if (JSON.stringify(result.outputs).length > 262144) invalid("outputs", "结果超过 256 KiB，请使用命名文件产物")
  return result
}

export function failedNodeResult(snapshot: RunSnapshot, nodeId: string, childId?: string): NodeResult {
  return { status: snapshot.status === "stopped" ? "cancelled" : "failed", confirmation: "unverified", runId: snapshot.id, nodeId, attempt: snapshot.nodes.find((node) => node.nodeId === nodeId)?.attempts ?? 0, ...(childId === undefined ? {} : { childId }), outputs: {}, artifacts: [] }
}
