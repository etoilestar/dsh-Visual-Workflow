import { parseDifyWorkflow } from "./source/dify/parser.js";
export class WorkflowImportService {
    parse(source, platform) {
        const parsed = parseDifyWorkflow(source);
        return { source: parsed.workflow, capabilities: parsed.capabilities };
    }
}
//# sourceMappingURL=service.js.map