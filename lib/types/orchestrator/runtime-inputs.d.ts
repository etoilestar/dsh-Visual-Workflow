import type { WorkflowDocument } from "../shared/graph-model.js";
import type { JsonValue, RuntimeInputs, RuntimeInputValue, SessionInputFile } from "../shared/runtime-types.js";
export declare function jsonValueOf(value: unknown, field: string, depth?: number, ancestors?: Set<unknown>): JsonValue;
interface Access {
    cwd?: string;
    managedRoot: string;
    files: readonly SessionInputFile[];
}
export declare function inputSlotsOf(raw: unknown, field: string, access: Access): Promise<Record<string, RuntimeInputValue[]>>;
export declare function runtimeInputsOf(raw: unknown, flow: WorkflowDocument, access: Access): Promise<RuntimeInputs>;
export {};
