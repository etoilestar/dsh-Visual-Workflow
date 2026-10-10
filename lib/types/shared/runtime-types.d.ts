export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [name: string]: JsonValue;
};
export type HandoffPolicy = "explicit" | "auto" | "strict";
export interface RuntimeFileRef {
    source: "workspace" | "managed" | "attachment";
    path?: string;
    attachmentId?: string;
    name?: string;
    bytes?: number;
}
export interface InputOrigin {
    source: "user" | "workspace" | "managed" | "attachment" | "node";
    runId?: string;
    nodeId?: string;
    attempt?: number;
    output?: string;
}
export type RuntimeInputValue = ({
    kind: "text";
    value: string;
} | {
    kind: "json";
    value: JsonValue;
} | {
    kind: "file";
    fileRef: RuntimeFileRef;
} | {
    kind: "output";
    nodeId: string;
    output?: string;
    runId?: string;
    attempt?: number;
}) & {
    origin?: InputOrigin;
};
export interface RuntimeInputs {
    workflowInputs: Record<string, RuntimeInputValue[]>;
    nodeInputs: Record<string, Record<string, RuntimeInputValue[]>>;
    parameters?: Record<string, JsonValue>;
}
export interface InputRequirement {
    kind?: "text" | "json" | "file";
    required?: boolean;
    source?: {
        workflowInput: string;
    } | {
        nodeId: string;
        output?: string;
    };
}
export interface ResultSchema {
    type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
    properties?: Record<string, ResultSchema>;
    required?: string[];
    additionalProperties?: boolean;
    items?: ResultSchema;
    enum?: Array<string | number | boolean | null>;
    minLength?: number;
    minItems?: number;
    minimum?: number;
}
export interface OutputRequirement {
    kind: "text" | "json" | "file";
    required?: boolean;
    path?: string;
    schema?: ResultSchema;
}
export interface RuntimeBudget {
    executionTimeoutMs?: number;
    parentCallLimit?: number;
    nodeExecutionLimit?: number;
    tokenLimit?: number;
    repeatedFailureLimit?: number;
}
export interface WorkflowRuntimeDefinition {
    version: 1;
    handoffPolicy?: HandoffPolicy;
    inputs?: Record<string, InputRequirement>;
    budget?: RuntimeBudget;
}
export interface VerifiedArtifact {
    path: string;
    size: number;
    verifiedAt: string;
    name?: string;
    runId?: string;
    nodeId?: string;
    attempt?: number;
    signature?: string;
}
export interface NodeResult {
    status: "succeeded" | "failed" | "cancelled";
    confirmation: "turn" | "verified" | "unverified";
    runId: string;
    nodeId: string;
    attempt: number;
    childId?: string;
    outputs: Record<string, JsonValue>;
    artifacts: VerifiedArtifact[];
}
export interface NodeInvocation {
    runId: string;
    nodeId: string;
    attempt: number;
    inputRevision: number;
    inputs: Record<string, RuntimeInputValue[]>;
    parameters: Record<string, JsonValue>;
    selectedEdgeIds?: string[];
}
export interface RuntimeEvent {
    runId: string;
    flowId: string;
    nodeId?: string;
    attempt?: number;
    childId?: string;
    phase: string;
    status: string;
    errorCode?: string;
    at: string;
    inputRevision?: number;
    inputNames?: string[];
}
export interface SessionInputFile {
    attachmentId: string;
    name: string;
    bytes: number;
    path: string;
}
export interface RuntimeInputOptions {
    workflowInputs: Record<string, InputRequirement>;
    nodeInputs: Record<string, Record<string, InputRequirement>>;
    files: SessionInputFile[];
    handoffPolicy: HandoffPolicy;
    workingDirectory?: string;
    checkpoint?: {
        runId: string;
        runtimeInputs?: RuntimeInputs;
        handoffPolicy?: HandoffPolicy;
    };
}
