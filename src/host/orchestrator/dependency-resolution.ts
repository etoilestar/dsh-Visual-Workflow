import { ctxInEdges, isFlowLine, mainNodeIdOf, nodeById } from "../graph/index.js"
import type { Line, RoleNode, WorkflowDocument } from "../shared/graph-model.js"
import type { NodeInvocation, RuntimeInputValue } from "../shared/runtime-types.js"
import type { RunSnapshot } from "../shared/types.js"
import { executionOf } from "./execution-inputs.js"
import { WfError } from "./errors.js"

const settled = (status: string | undefined): boolean => status === "ok" || status === "react-capped" || status === "armed"
function dependencyError(message: string, code = "WF_DEPENDENCY_UNSATISFIED"): never {
  throw new WfError(message, code, { phase: "node_input", retryable: false })
}

export interface ResolvedDependencies { invocation: NodeInvocation; contextEdges: Line[]; controlSources: string[] }

/** Resolve only current settled results; branch selection is supplied by the coordinator, never guessed. */
export function resolveNodeDependencies(flow: WorkflowDocument, node: RoleNode, snapshot: RunSnapshot, selectedEdgeIds?: string[]): ResolvedDependencies {
  const idOf = (id: string): string => mainNodeIdOf(flow, id) ?? id
  const recordOf = (id: string) => snapshot.nodes.find((record) => record.nodeId === idOf(id))
  const policy = snapshot.handoffPolicy ?? flow.runtime?.handoffPolicy ?? "explicit"
  const contract = executionOf(node)
  const incoming = flow.lines.filter((line) => isFlowLine(line) && idOf(line.target) === node.id)
  const conditional = incoming.filter((line) => line.condition)
  if (selectedEdgeIds !== undefined && (!Array.isArray(selectedEdgeIds) || selectedEdgeIds.some((id) => typeof id !== "string" || !conditional.some((line) => line.id === id)) || new Set(selectedEdgeIds).size !== selectedEdgeIds.length)) dependencyError("selectedEdgeIds 必须是本节点条件入线的唯一 ID", "WF_BAD_ARGS")
  if (policy !== "explicit" && conditional.length && selectedEdgeIds === undefined) dependencyError("条件路径尚未选择；请传入 selectedEdgeIds", "WF_HANDOFF_AMBIGUOUS")
  const active = incoming.filter((line) => !line.condition || selectedEdgeIds === undefined || selectedEdgeIds.includes(line.id))
  const controlSources = [...new Set(active.map((line) => idOf(line.source)))]
  if (policy !== "explicit") {
    if (incoming.length && !active.length) dependencyError("当前节点没有已选中的控制路径")
    for (const line of active) {
      const source = nodeById(flow, idOf(line.source))
      if (source?.kind === "start" && flow.mode === "mode1") continue
      const status = recordOf(line.source)?.status
      if (!settled(status) && !(line.condition?.type === "fail" && status === "fail")) dependencyError(`控制依赖尚未结算：${idOf(line.source)}`)
    }
  }
  const inactiveSources = new Set(incoming.filter((line) => line.condition && selectedEdgeIds !== undefined && !selectedEdgeIds.includes(line.id)).map((line) => idOf(line.source)).filter((id) => !controlSources.includes(id)))
  const contextEdges = ctxInEdges(flow, node.id).filter((line) => !inactiveSources.has(idOf(line.source)))
  if (policy !== "explicit") for (const source of controlSources) {
    const kind = nodeById(flow, source)?.kind
    if (["agent", "parent", "group"].includes(kind ?? "") && !contextEdges.some((line) => idOf(line.source) === source)) contextEdges.push({ id: `runtime:${source}:${node.id}`, source, target: node.id, sourceHandle: "ctx-out", targetHandle: "ctx-in" })
  }

  const outputValues = (sourceId: string, output?: string, selfPrevious = false): Record<string, RuntimeInputValue[]> => {
    const id = idOf(sourceId)
    if (inactiveSources.has(id)) dependencyError(`不能消费未选中分支：${id}`)
    const source = nodeById(flow, id)
    const record = recordOf(id)
    if (!record || !settled(record.status)) dependencyError(`上游结果尚未有效结算：${id}`)
    if (id === node.id && !selfPrevious) dependencyError("循环输入必须显式指定上一 attempt", "WF_HANDOFF_AMBIGUOUS")
    if (source?.kind === "group") {
      if (record.status !== "ok") dependencyError(`协作组尚未完成：${id}`)
      const values: Record<string, RuntimeInputValue[]> = {}
      for (const memberId of source.data.memberIds) for (const [name, parts] of Object.entries(outputValues(memberId))) values[`${memberId}.${name}`] = parts
      if (output !== undefined && !Object.hasOwn(values, output)) dependencyError(`协作组缺少命名输出：${id}.${output}`)
      return output === undefined ? values : { [output]: values[output] }
    }
    const result = record.result
    if (result && (result.status !== "succeeded" || result.nodeId !== id || result.attempt !== record.attempts || result.runId !== snapshot.id && !record.resumed || result.childId !== undefined && record.childId !== result.childId)) dependencyError(`上游结果代际不匹配：${id}`)
    const values: Record<string, RuntimeInputValue[]> = {}
    const origin = { source: "node" as const, runId: result?.runId ?? snapshot.id, nodeId: id, attempt: record.attempts }
    for (const [name, value] of Object.entries(result?.outputs ?? (record.output?.trim() ? { response: record.output } : {}))) {
      const kind = source?.kind === "agent" || source?.kind === "parent" ? executionOf(source).outputs?.[name]?.kind : undefined
      values[name] = [{ ...(kind === "text" || kind === undefined && typeof value === "string" ? { kind: "text" as const, value: String(value) } : { kind: "json" as const, value: structuredClone(value) }), origin: { ...origin, output: name } }]
    }
    for (const artifact of result?.artifacts ?? record.artifacts ?? []) {
      if (artifact.attempt !== undefined && artifact.attempt !== record.attempts || artifact.nodeId !== undefined && artifact.nodeId !== id || artifact.runId !== undefined && artifact.runId !== origin.runId) dependencyError(`文件产物代际不匹配：${id}`)
      const name = artifact.name ?? "artifact"
      ;(values[name] ??= []).push({ kind: "file", fileRef: { source: "workspace", path: artifact.path }, origin: { ...origin, output: name } })
    }
    if (output !== undefined && !Object.hasOwn(values, output)) dependencyError(`上游缺少命名输出：${id}.${output}`)
    return output === undefined ? values : { [output]: values[output] }
  }
  const resolveValues = (values: RuntimeInputValue[]): RuntimeInputValue[] => values.flatMap((value) => {
    if (value.kind !== "output") return [structuredClone(value)]
    const source = recordOf(value.nodeId)
    const selfPrevious = idOf(value.nodeId) === node.id && value.attempt !== undefined && value.attempt === source?.attempts
    const result = outputValues(value.nodeId, value.output, selfPrevious)
    const parts = Object.values(result).flat()
    if (value.output === undefined && Object.keys(result).length > 1) dependencyError(`输出引用需要选择名称：${value.nodeId}`, "WF_HANDOFF_AMBIGUOUS")
    if (parts.some((part) => value.attempt !== undefined && part.origin?.attempt !== value.attempt || value.runId !== undefined && part.origin?.runId !== value.runId)) dependencyError(`输出引用不属于指定代际：${value.nodeId}`)
    return parts
  })
  const inputs: Record<string, RuntimeInputValue[]> = {}
  const workflow = snapshot.runtimeInputs?.workflowInputs ?? {}
  const requirements = contract.inputs ?? {}
  if (!Object.keys(requirements).length) for (const [name, values] of Object.entries(workflow)) inputs[name] = resolveValues(values)
  for (const [name, values] of Object.entries(snapshot.runtimeInputs?.nodeInputs[node.id] ?? {})) inputs[name] = resolveValues(values)
  const candidates: Record<string, RuntimeInputValue[]> = {}
  if (policy !== "explicit") for (const edge of contextEdges) {
    const id = idOf(edge.source)
    const source = nodeById(flow, id)
    if (!["agent", "parent", "group", "start"].includes(source?.kind ?? "")) continue
    if (!settled(recordOf(id)?.status)) { if (policy === "strict" || contract.inputSource === "ctx") dependencyError(`数据依赖尚未结算：${id}`); continue }
    for (const [name, values] of Object.entries(outputValues(id))) candidates[`${id}.${name}`] = values
  }
  for (const [name, requirement] of Object.entries(requirements)) {
    if (!inputs[name]?.length) {
      const source = requirement.source
      if (source && "workflowInput" in source) inputs[name] = resolveValues(workflow[source.workflowInput] ?? [])
      else if (source && "nodeId" in source) {
        const selected = outputValues(source.nodeId, source.output)
        if (source.output === undefined && Object.keys(selected).length > 1) dependencyError(`输入 ${name} 需要明确选择输出`, "WF_HANDOFF_AMBIGUOUS")
        inputs[name] = Object.values(selected).flat()
      } else if (workflow[name]?.length) inputs[name] = resolveValues(workflow[name])
      else if (policy !== "explicit") {
        const matching = Object.values(candidates).filter((values) => values.length && (!requirement.kind || values.every((value) => value.kind === requirement.kind)))
        if (matching.length > 1) dependencyError(`输入 ${name} 有多个有效来源，请声明 source`, "WF_HANDOFF_AMBIGUOUS")
        if (matching.length === 1) inputs[name] = matching[0]
      }
    }
    if (requirement.required !== false && !inputs[name]?.length) dependencyError(`节点 ${node.id} 缺少输入 ${name}`, "WF_INPUT_REQUIRED")
    if (requirement.kind && inputs[name]?.some((value) => value.kind !== requirement.kind)) dependencyError(`节点输入 ${name} 类型不符`, "WF_RUNTIME_INPUT_INVALID")
  }
  for (const [name, values] of Object.entries(candidates)) if (!Object.hasOwn(inputs, name)) inputs[name] = values
  return { invocation: { runId: snapshot.id, nodeId: node.id, attempt: (recordOf(node.id)?.attempts ?? 0) + 1, inputRevision: snapshot.inputRevision ?? 0, inputs, parameters: structuredClone(snapshot.runtimeInputs?.parameters ?? {}), ...(selectedEdgeIds === undefined ? {} : { selectedEdgeIds: [...selectedEdgeIds] }) }, contextEdges, controlSources }
}

export function assertInvocationCurrent(snapshot: RunSnapshot, invocation: NodeInvocation): void {
  if (snapshot.id !== invocation.runId || (snapshot.inputRevision ?? 0) !== invocation.inputRevision) dependencyError("派发期间运行输入版本已变化", "WF_INPUT_REVISION_CONFLICT")
  for (const value of Object.values(invocation.inputs).flat()) {
    const origin = value.origin
    if (origin?.source !== "node" || origin.nodeId === invocation.nodeId) continue
    const record = snapshot.nodes.find((record) => record.nodeId === origin.nodeId)
    if (!record || !settled(record.status) || record.attempts !== origin.attempt || record.result && (record.result.status !== "succeeded" || record.result.runId !== origin.runId)) dependencyError(`派发期间上游代际已变化：${origin.nodeId}`)
  }
}
