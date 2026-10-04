import type { WorkflowDocument, WorkflowValidationWarning } from "../../shared/graph-model.js";
import type { GraphPatchOp } from "./types.js";
export type ResponsibilityRepairScope = "small" | "medium" | "large";
export type ResponsibilityRepairChange = {
    kind: "update_node";
    data: Record<string, unknown>;
} | {
    kind: "insert_node";
    node: Record<string, unknown>;
    replaceLineId: string;
} | {
    kind: "adjust_edges";
    disconnectLineIds: string[];
    connections: Array<Extract<GraphPatchOp, {
        op: "connect";
    }>>;
};
export interface ResponsibilityRepairProposal {
    targetResponsibilityId: string;
    targetNodeId: string;
    scope: ResponsibilityRepairScope;
    warning: WorkflowValidationWarning;
    ops: GraphPatchOp[];
    preservedNodeIds: string[];
    preservedLineIds: string[];
    requiresConfirmation: true;
}
/**
 * 生成待用户确认的局部 wf_graph_patch proposal；本函数不写图也不调用工具。
 * 无法唯一定位责任或无法证明操作局部时返回 null，避免退化为整图重建。
 */
export declare function planResponsibilityRepair(input: {
    workflow: WorkflowDocument;
    warning: WorkflowValidationWarning;
    targetResponsibilityId: string;
    change: ResponsibilityRepairChange;
}): ResponsibilityRepairProposal | null;
