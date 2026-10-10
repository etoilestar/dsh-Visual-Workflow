import type { SourceWorkflowIR } from "./ir/source-ir.js";
import type { DifyCapabilities } from "./source/dify/normalize.js";
export interface WorkflowImportParseResult {
    source: SourceWorkflowIR;
    capabilities: DifyCapabilities;
}
