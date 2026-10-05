import { isRecord } from "./variables.js"

export function isDifyWorkflowDocument(value: unknown): boolean {
  return isRecord(value) && isRecord(value.workflow) && isRecord(value.workflow.graph)
}
