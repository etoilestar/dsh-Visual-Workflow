import type { RoleNode, WorkflowDocument } from "../shared/graph-model.js";
import type { InputSlots } from "../shared/runtime-types.js";
import type { RunSnapshot } from "../shared/types.js";
/** Workflow inputs belong to one initial Agent, never to every node or an arbitrary branch. */
export declare function workflowInputTarget(flow: WorkflowDocument): string;
export declare function boundNodeInputs(snapshot: RunSnapshot, nodeId: string): InputSlots;
/** Automatic handoff is limited to a unique unconditional direct Agent predecessor. */
export declare function effectiveNodeInputs(flow: WorkflowDocument, node: RoleNode, snapshot: RunSnapshot): Promise<InputSlots>;
