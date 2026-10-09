import type { SourcePortIR, VariableReference } from "../../ir/source-ir.js";
export declare function findVariableReferences(value: unknown): VariableReference[];
export declare function findSelectorReferences(config: Record<string, unknown>): VariableReference[];
export declare function referenceInputs(config: Record<string, unknown>): SourcePortIR[];
export declare function isRecord(value: unknown): value is Record<string, unknown>;
