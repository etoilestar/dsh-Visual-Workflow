import type { WorkflowDocument } from "../shared/graph-model.js";
export type SemanticIssueType = "requirement_uncovered" | "requirement_partially_covered" | "responsibility_overlap" | "dataflow_semantic_mismatch";
export type SemanticIssueLevel = "error" | "warning";
export type SemanticRepairMode = "local" | "subgraph" | "boundary_replan";
export interface SemanticRequirement {
    id: string;
    text: string;
    ownerNodeIds: string[];
}
export interface SemanticIssue {
    type: SemanticIssueType;
    level: SemanticIssueLevel;
    requirementIds: string[];
    affectedNodeIds: string[];
    reason: string;
    evidence: string;
    repairGuidance: string;
}
export interface SemanticReviewResult {
    passed: boolean;
    requirements: SemanticRequirement[];
    issues: SemanticIssue[];
}
export interface SemanticReviewOutcome {
    available: boolean;
    result?: SemanticReviewResult;
    unavailableReason?: string;
}
export interface SemanticFailureState {
    candidate: WorkflowDocument;
    issues: SemanticIssue[];
    fingerprint: string;
    repeatCount: number;
    affectedNodeIds: string[];
    repairMode: SemanticRepairMode;
}
export interface SemanticPlanningContext {
    planningId: string;
    sessionId: string;
    originalUserIntent: string;
    failure?: SemanticFailureState;
}
export interface SemanticPlanningLike {
    getPlanningContext(sessionId: string): SemanticPlanningContext | undefined;
    reviewCandidate(sessionId: string, planningId: string, candidate: WorkflowDocument): Promise<SemanticReviewOutcome>;
    validateRepairScope(sessionId: string, planningId: string, candidate: WorkflowDocument): void;
    recordFailure(sessionId: string, planningId: string, candidate: WorkflowDocument, issues: SemanticIssue[]): SemanticFailureState;
    clearFailure(sessionId: string, planningId: string): void;
}
