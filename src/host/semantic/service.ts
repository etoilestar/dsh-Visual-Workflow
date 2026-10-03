import type { WorkflowDocument } from "../shared/graph-model.js"
import { validateSemanticRepairScope } from "./repair-scope.js"
import { repairModeFor, semanticIssueFingerprint } from "./repair-state.js"
import type { SemanticIssue, SemanticPlanningContext, SemanticReviewOutcome, SemanticFailureState } from "./types.js"
import { SemanticReviewer } from "./reviewer.js"

export class SemanticPlanningService {
  private readonly contexts = new Map<string, SemanticPlanningContext>()

  constructor(private readonly reviewer: SemanticReviewer) {}

  recordArrangeIntent(sessionId: string, planningId: string, originalUserIntent: string): void {
    this.contexts.set(sessionId, { sessionId, planningId, originalUserIntent })
  }

  getPlanningContext(sessionId: string): SemanticPlanningContext | undefined {
    return this.contexts.get(sessionId)
  }

  async reviewCandidate(sessionId: string, planningId: string, candidate: WorkflowDocument): Promise<SemanticReviewOutcome> {
    const context = this.match(sessionId, planningId)
    return this.reviewer.review(context.originalUserIntent, candidate)
  }

  validateRepairScope(sessionId: string, planningId: string, candidate: WorkflowDocument): void {
    const failure = this.match(sessionId, planningId).failure
    if (!failure) return
    const violation = validateSemanticRepairScope(failure, candidate)
    if (violation) {
      const error = new Error(`allowedNodeIds=${violation.allowedNodeIds.join(",")}\nchangedOutsideScope=${violation.changedOutsideScope.join(",")}\n保留未受影响节点，只修改 Reviewer 指定的局部区域。`)
      ;(error as Error & { code: string }).code = "WF_REPAIR_SCOPE_EXCEEDED"
      throw error
    }
  }

  recordFailure(sessionId: string, planningId: string, candidate: WorkflowDocument, issues: SemanticIssue[]): SemanticFailureState {
    const context = this.match(sessionId, planningId)
    const fingerprint = semanticIssueFingerprint(issues)
    const repeatCount = context.failure?.fingerprint === fingerprint ? context.failure.repeatCount + 1 : 1
    const failure: SemanticFailureState = {
      candidate: structuredClone(candidate),
      issues: structuredClone(issues),
      fingerprint,
      repeatCount,
      affectedNodeIds: [...new Set(issues.filter((issue) => issue.level === "error").flatMap((issue) => issue.affectedNodeIds))],
      repairMode: repairModeFor(repeatCount),
    }
    context.failure = failure
    return failure
  }

  clearFailure(sessionId: string, planningId: string): void {
    delete this.match(sessionId, planningId).failure
  }

  private match(sessionId: string, planningId: string): SemanticPlanningContext {
    const context = this.contexts.get(sessionId)
    if (!context || context.planningId !== planningId || context.sessionId !== sessionId) {
      const error = new Error("planningId 不属于当前会话或已被新的 /arrange 替换")
      ;(error as Error & { code: string }).code = "WF_BAD_ARGS"
      throw error
    }
    return context
  }
}
