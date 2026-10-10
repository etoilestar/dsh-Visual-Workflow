import type { RoleNode } from "../shared/graph-model.js";
import type { JsonValue, NodeResult, ResultSchema } from "../shared/runtime-types.js";
import type { RunSnapshot } from "../shared/types.js";
export declare function validateResultSchema(value: JsonValue, schema: ResultSchema, field: string): void;
export declare function buildNodeResult(node: RoleNode, snapshot: RunSnapshot, text: string, childId?: string, fullLimit?: number): NodeResult;
export declare function failedNodeResult(snapshot: RunSnapshot, nodeId: string, childId?: string): NodeResult;
