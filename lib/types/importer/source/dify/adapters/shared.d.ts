import type { SourceNodeIR, SourcePortIR, SourceSemanticKind } from "../../../ir/source-ir.js";
import type { NormalizeContext } from "../../registry.js";
export interface DifyNodeParts {
    id: string;
    type: string;
    data: Record<string, unknown>;
    raw: unknown;
}
export declare function readDifyNode(node: unknown): DifyNodeParts | undefined;
export declare function supportsType(node: unknown, types: readonly string[]): boolean;
export declare function normalizeNode(node: unknown, context: NormalizeContext, semanticKind: SourceSemanticKind, ports?: {
    inputs?: SourcePortIR[];
    outputs?: SourcePortIR[];
}): SourceNodeIR;
export declare function startOutputs(node: unknown): SourcePortIR[];
