import type { InputRequirement, OutputRequirement, ResultSchema, WorkflowRuntimeDefinition } from "../shared/runtime-types.js";
export declare function recordOf(value: unknown, field: string): Record<string, unknown>;
export declare function nameOf(name: string, field: string): void;
export declare function inputRequirementsOf(raw: unknown, field?: string): Record<string, InputRequirement>;
export declare function resultSchemaOf(raw: unknown, field: string, depth?: number): ResultSchema;
export declare function outputRequirementsOf(raw: unknown): Record<string, OutputRequirement>;
export declare function runtimeDefinitionOf(raw: unknown): WorkflowRuntimeDefinition | undefined;
