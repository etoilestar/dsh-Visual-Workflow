import type { SemanticIssue, SemanticRepairMode } from "./types.js"

export function semanticIssueFingerprint(issues: SemanticIssue[]): string {
  return issues
    .filter((issue) => issue.level === "error")
    .map((issue) => `${issue.type}|${[...issue.requirementIds].sort().join(",")}|${[...issue.affectedNodeIds].sort().join(",")}`)
    .sort()
    .join(";")
}

export function repairModeFor(repeatCount: number): SemanticRepairMode {
  if (repeatCount >= 3) return "boundary_replan"
  if (repeatCount === 2) return "subgraph"
  return "local"
}
