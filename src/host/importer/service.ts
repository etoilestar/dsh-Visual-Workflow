import type { WorkflowImportParseResult } from "./types.js"
import { parseDifyWorkflow } from "./source/dify/parser.js"

export class WorkflowImportService {
  public parse(source: string, platform: "dify"): WorkflowImportParseResult {
    const parsed = parseDifyWorkflow(source)
    return { source: parsed.workflow, capabilities: parsed.capabilities }
  }
}
