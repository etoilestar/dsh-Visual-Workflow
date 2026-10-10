import type { Line, RoleNode, WorkflowDocument } from "../shared/graph-model.js";
import type { NodeInvocation } from "../shared/runtime-types.js";
import type { RunSnapshot } from "../shared/types.js";
export interface ResolvedDependencies {
    invocation: NodeInvocation;
    contextEdges: Line[];
    controlSources: string[];
}
/** Resolve only current settled results; branch selection is supplied by the coordinator, never guessed. */
export declare function resolveNodeDependencies(flow: WorkflowDocument, node: RoleNode, snapshot: RunSnapshot, selection?: unknown): ResolvedDependencies;
export declare function assertInvocationCurrent(snapshot: RunSnapshot, invocation: NodeInvocation): void;
