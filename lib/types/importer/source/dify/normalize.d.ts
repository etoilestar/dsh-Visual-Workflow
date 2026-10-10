import type { SourceWorkflowIR } from "../../ir/source-ir.js";
export interface DifyCapabilities {
    dslVersion?: string;
    hasGraph: boolean;
    hasVariables: boolean;
    hasEnvironmentVariables: boolean;
    hasConversationVariables: boolean;
    nodeTypes: Set<string>;
    unknownFields: string[];
    unknownNodeTypes: string[];
}
export interface NormalizedDifyWorkflow {
    workflow: SourceWorkflowIR;
    capabilities: DifyCapabilities;
}
export declare function normalizeDifyDocument(document: unknown): NormalizedDifyWorkflow;
