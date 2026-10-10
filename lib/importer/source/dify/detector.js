import { isRecord } from "./variables.js";
export function isDifyWorkflowDocument(value) {
    return isRecord(value) && isRecord(value.workflow) && isRecord(value.workflow.graph);
}
//# sourceMappingURL=detector.js.map