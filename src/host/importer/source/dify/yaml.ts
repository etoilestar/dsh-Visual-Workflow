import { parse } from "yaml"
import { WorkflowImportError } from "../../errors.js"

export function parseYamlDocument(source: string): unknown {
  try {
    return parse(source)
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown YAML parsing error"
    throw new WorkflowImportError("invalid_yaml", `The import file is not valid YAML: ${detail}`)
  }
}
