import type { RuntimeInputValue, RuntimeInputs, RuntimeInputOptions, SessionInputFile } from "../../host/shared/runtime-types.js";
export type InputEditorKind = "text" | "json" | "workspace" | "attachment" | "output";
export declare function formInputValue(kind: InputEditorKind, value: string, files: readonly SessionInputFile[]): RuntimeInputValue;
export declare function missingWorkflowInputs(inputs: RuntimeInputs, options: RuntimeInputOptions): string[];
export declare function validInputSlot(name: string): boolean;
