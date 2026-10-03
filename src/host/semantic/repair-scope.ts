import { summarizeFlowChange } from "../orchestrator/flow-diff.js"
import type { WorkflowDocument } from "../shared/graph-model.js"
import type { SemanticFailureState } from "./types.js"

export interface RepairScopeViolation {
  allowedNodeIds: string[]
  changedOutsideScope: string[]
}

export function validateSemanticRepairScope(previous: SemanticFailureState, next: WorkflowDocument): RepairScopeViolation | null {
  if (previous.repairMode === "boundary_replan") return null
  const allowed = allowedNodeIds(previous)
  const diff = summarizeFlowChange(previous.candidate, next)
  const changedOutside = [...diff.changedNodeIds, ...diff.removedNodeIds].filter((id) => !allowed.has(id))
  const added = new Set(diff.addedNodeIds)
  const permitsAdd = previous.issues.some((issue) => issue.level === "error" && issue.type === "requirement_uncovered")
  if (!permitsAdd) changedOutside.push(...diff.addedNodeIds)
  for (const key of [...diff.addedLineKeys, ...diff.removedLineKeys]) {
    const [source, , target] = key.split("|")
    if (!allowed.has(source) && !allowed.has(target) && !added.has(source) && !added.has(target)) changedOutside.push(`line:${key}`)
  }
  return changedOutside.length > 0
    ? { allowedNodeIds: [...allowed].sort(), changedOutsideScope: [...new Set(changedOutside)].sort() }
    : null
}

function allowedNodeIds(failure: SemanticFailureState): Set<string> {
  const allowed = new Set(failure.affectedNodeIds)
  if (failure.repairMode !== "subgraph") return allowed
  for (const line of failure.candidate.lines ?? []) {
    const isFlow = line.sourceHandle === "flow-out" || line.targetHandle === "flow-in"
    const isCtx = line.sourceHandle === "ctx-out" || line.targetHandle === "ctx-in"
    if ((!isFlow && !isCtx) || (!allowed.has(line.source) && !allowed.has(line.target))) continue
    allowed.add(line.source)
    allowed.add(line.target)
  }
  return allowed
}
