export declare class WorkflowImportError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
