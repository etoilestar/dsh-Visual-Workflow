import { isAbsolute, resolve } from "node:path"
import { mainNodeIdOf, nameOf, nodeById, recordOf } from "../graph/index.js"
import type { WorkflowDocument } from "../shared/graph-model.js"
import type { JsonValue, RuntimeInputs, RuntimeInputValue, SessionInputFile } from "../shared/runtime-types.js"
import { WfError } from "./errors.js"
import { authorizedInputPath } from "./execution-file-access.js"

function bad(field: string, message: string): never { throw new WfError(`${field}: ${message}`, "WF_RUNTIME_INPUT_INVALID", { phase: "node_input", retryable: false, details: [{ field, message }] }) }
export function jsonValueOf(value: unknown, field: string, depth = 0, ancestors = new Set<unknown>()): JsonValue {
  if (depth > 24) bad(field, "JSON 结构过深")
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (!value || typeof value !== "object" || ancestors.has(value)) bad(field, "必须为有限无循环的 JSON 值")
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return value.map((item, index) => jsonValueOf(item, `${field}[${index}]`, depth + 1, ancestors))
    const result: Record<string, JsonValue> = {}
    for (const [name, part] of Object.entries(recordOf(value, field))) { nameOf(name, field); result[name] = jsonValueOf(part, `${field}.${name}`, depth + 1, ancestors) }
    return result
  } finally { ancestors.delete(value) }
}
interface Access { cwd?: string; managedRoot: string; files: readonly SessionInputFile[] }
async function inputValueOf(raw: unknown, field: string, access: Access): Promise<RuntimeInputValue> {
  const part = recordOf(raw, field)
  if (part.kind === "text") { if (typeof part.value !== "string") bad(`${field}.value`, "必须为文本"); return { kind: "text", value: part.value, origin: { source: "user" } } }
  if (part.kind === "json") return { kind: "json", value: jsonValueOf(part.value, `${field}.value`), origin: { source: "user" } }
  if (part.kind === "output") {
    if (typeof part.nodeId !== "string" || !part.nodeId.trim()) bad(`${field}.nodeId`, "必须指定上游节点")
    if (part.output !== undefined && (typeof part.output !== "string" || !part.output.trim())) bad(`${field}.output`, "必须为输出名称")
    if (part.runId !== undefined && typeof part.runId !== "string") bad(`${field}.runId`, "必须为运行 ID")
    if (part.attempt !== undefined && (!Number.isSafeInteger(part.attempt) || Number(part.attempt) < 1)) bad(`${field}.attempt`, "必须为正整数")
    return { kind: "output", nodeId: part.nodeId, ...(part.output === undefined ? {} : { output: part.output as string }), ...(part.runId === undefined ? {} : { runId: part.runId as string }), ...(part.attempt === undefined ? {} : { attempt: part.attempt as number }) }
  }
  if (part.kind !== "file") bad(`${field}.kind`, "必须为 text/json/file/output")
  const ref = recordOf(part.fileRef, `${field}.fileRef`)
  if (ref.source === "attachment") {
    const file = access.files.find((file) => file.attachmentId === ref.attachmentId && file.name === ref.name && file.bytes === ref.bytes)
    if (!file) throw new WfError(`${field}: 附件未获当前会话授权，请通过工作台受控上传或选择`, "WF_INPUT_FILE_UNAUTHORIZED", { phase: "node_input", retryable: false })
    const path = await authorizedInputPath(file.path, undefined, undefined, access.files.map((file) => file.path))
    return { kind: "file", fileRef: { source: "attachment", ...file, path }, origin: { source: "attachment" } }
  }
  if (ref.source !== "workspace" && ref.source !== "managed") bad(`${field}.fileRef.source`, "必须为 workspace/managed/attachment")
  if (typeof ref.path !== "string" || !ref.path.trim()) bad(`${field}.fileRef.path`, "必须为明确路径")
  if (ref.source === "workspace" && !access.cwd) throw new WfError("工作区输入需要实际会话工作目录", "WF_INPUT_PATH_UNRESOLVED", { phase: "node_input", retryable: false })
  const absolute = isAbsolute(ref.path) ? ref.path : resolve(ref.source === "workspace" ? access.cwd! : access.managedRoot, ref.path)
  const path = await authorizedInputPath(absolute, ref.source === "workspace" ? access.cwd : undefined, ref.source === "managed" ? access.managedRoot : undefined)
  return { kind: "file", fileRef: { source: ref.source, path }, origin: { source: ref.source } }
}
export async function inputSlotsOf(raw: unknown, field: string, access: Access): Promise<Record<string, RuntimeInputValue[]>> {
  const entries = Object.entries(recordOf(raw, field))
  if (entries.length > 128) bad(field, "输入槽超过 128 项")
  const result: Record<string, RuntimeInputValue[]> = {}
  for (const [name, values] of entries) {
    nameOf(name, field)
    if (!Array.isArray(values) || values.length > 32) bad(`${field}.${name}`, "必须为最多 32 项的输入数组")
    result[name] = await Promise.all(values.map((value, index) => inputValueOf(value, `${field}.${name}[${index}]`, access)))
  }
  return result
}
export async function runtimeInputsOf(raw: unknown, flow: WorkflowDocument, access: Access): Promise<RuntimeInputs> {
  try {
    const part = recordOf(raw, "runtimeInputs")
    const result: RuntimeInputs = { workflowInputs: await inputSlotsOf(part.workflowInputs ?? {}, "runtimeInputs.workflowInputs", access), nodeInputs: {} }
    for (const [id, slots] of Object.entries(recordOf(part.nodeInputs ?? {}, "runtimeInputs.nodeInputs"))) {
      const canonical = mainNodeIdOf(flow, id) ?? id
      const node = nodeById(flow, canonical)
      if (!node || node.kind !== "agent" && node.kind !== "parent") bad(`runtimeInputs.nodeInputs.${id}`, "必须指向可执行节点")
      if (Object.hasOwn(result.nodeInputs, canonical)) bad(`runtimeInputs.nodeInputs.${id}`, "主节点和 proxy 不得重复绑定")
      result.nodeInputs[canonical] = await inputSlotsOf(slots, `runtimeInputs.nodeInputs.${id}`, access)
    }
    if (part.parameters !== undefined) result.parameters = jsonValueOf(recordOf(part.parameters, "parameters"), "parameters") as Record<string, JsonValue>
    if (JSON.stringify(result).length > 262144) bad("runtimeInputs", "输入超过 256 KiB，请改用文件引用")
    return result
  } catch (error) { if (error instanceof WfError) throw error; bad("runtimeInputs", error instanceof Error ? error.message : "格式无效") }
}
