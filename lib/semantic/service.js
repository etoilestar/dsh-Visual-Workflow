import { validateSemanticRepairScope } from "./repair-scope.js";
import { repairModeFor, semanticIssueFingerprint } from "./repair-state.js";
import { SemanticReviewer } from "./reviewer.js";
export class SemanticPlanningService {
    reviewer;
    contexts = new Map();
    constructor(reviewer) {
        this.reviewer = reviewer;
    }
    recordArrangeIntent(sessionId, planningId, originalUserIntent) {
        this.contexts.set(sessionId, { sessionId, planningId, originalUserIntent });
    }
    getPlanningContext(sessionId) {
        return this.contexts.get(sessionId);
    }
    async reviewCandidate(sessionId, planningId, candidate) {
        const context = this.match(sessionId, planningId);
        return this.reviewer.review(context.originalUserIntent, candidate);
    }
    validateRepairScope(sessionId, planningId, candidate) {
        const failure = this.match(sessionId, planningId).failure;
        if (!failure)
            return;
        const violation = validateSemanticRepairScope(failure, candidate);
        if (violation) {
            const error = new Error(`allowedNodeIds=${violation.allowedNodeIds.join(",")}\nchangedOutsideScope=${violation.changedOutsideScope.join(",")}\n保留未受影响节点，只修改 Reviewer 指定的局部区域。`);
            error.code = "WF_REPAIR_SCOPE_EXCEEDED";
            throw error;
        }
    }
    recordFailure(sessionId, planningId, candidate, issues) {
        const context = this.match(sessionId, planningId);
        const fingerprint = semanticIssueFingerprint(issues);
        const repeatCount = context.failure?.fingerprint === fingerprint ? context.failure.repeatCount + 1 : 1;
        const failure = {
            candidate: structuredClone(candidate),
            issues: structuredClone(issues),
            fingerprint,
            repeatCount,
            affectedNodeIds: [...new Set(issues.filter((issue) => issue.level === "error").flatMap((issue) => issue.affectedNodeIds))],
            repairMode: repairModeFor(repeatCount),
        };
        context.failure = failure;
        return failure;
    }
    clearFailure(sessionId, planningId) {
        delete this.match(sessionId, planningId).failure;
    }
    match(sessionId, planningId) {
        const context = this.contexts.get(sessionId);
        if (!context || context.planningId !== planningId || context.sessionId !== sessionId) {
            const error = new Error("planningId 不属于当前会话或已被新的 /arrange 替换");
            error.code = "WF_BAD_ARGS";
            throw error;
        }
        return context;
    }
}
//# sourceMappingURL=service.js.map