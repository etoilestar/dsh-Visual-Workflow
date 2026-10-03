import type { WorkflowDocument } from "../shared/graph-model.js";
import type { SemanticIssue, SemanticPlanningContext, SemanticReviewOutcome, SemanticFailureState } from "./types.js";
import { SemanticReviewer } from "./reviewer.js";
export declare class SemanticPlanningService {
    private readonly reviewer;
    private readonly contexts;
    constructor(reviewer: SemanticReviewer);
    recordArrangeIntent(sessionId: string, planningId: string, originalUserIntent: string): void;
    getPlanningContext(sessionId: string): SemanticPlanningContext | undefined;
    reviewCandidate(sessionId: string, planningId: string, candidate: WorkflowDocument): Promise<SemanticReviewOutcome>;
    validateRepairScope(sessionId: string, planningId: string, candidate: WorkflowDocument): void;
    recordFailure(sessionId: string, planningId: string, candidate: WorkflowDocument, issues: SemanticIssue[]): SemanticFailureState;
    clearFailure(sessionId: string, planningId: string): void;
    private match;
}
