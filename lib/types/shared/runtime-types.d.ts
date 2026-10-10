export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
export type HandoffPolicy = "explicit" | "auto";
export interface SessionInputFile {
    attachmentId: string;
    name: string;
    bytes: number;
    path: string;
}
export type RuntimeFileRef = {
    source: "managed";
    path: string;
} | ({
    source: "attachment";
} & SessionInputFile) | {
    source: "node";
    path: string;
};
export interface InputOrigin {
    source: "user" | "managed" | "attachment" | "node";
    nodeId?: string;
    runId?: string;
    attempt?: number;
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
}) & {
    origin?: InputOrigin;
};
export type InputSlots = Record<string, RuntimeInputValue[]>;
export interface RuntimeInputs {
    workflowInputs: InputSlots;
    nodeInputs: Record<string, InputSlots>;
}
export interface InputRequirement {
    kind: "text" | "json" | "file";
    required?: boolean;
}
export interface RuntimeInputOptions {
    nodeInputs: Record<string, Record<string, InputRequirement>>;
    files: SessionInputFile[];
    handoffPolicy: HandoffPolicy;
    checkpoint?: {
        runId: string;
        runtimeInputs?: RuntimeInputs;
        handoffPolicy?: HandoffPolicy;
    };
}
