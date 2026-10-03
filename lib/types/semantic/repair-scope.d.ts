import type { WorkflowDocument } from "../shared/graph-model.js";
import type { SemanticFailureState } from "./types.js";
export interface RepairScopeViolation {
    allowedNodeIds: string[];
    changedOutsideScope: string[];
}
export declare function validateSemanticRepairScope(previous: SemanticFailureState, next: WorkflowDocument): RepairScopeViolation | null;
