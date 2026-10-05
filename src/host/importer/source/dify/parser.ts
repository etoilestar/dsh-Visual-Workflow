import type { NormalizedDifyWorkflow } from "./normalize.js"
import { normalizeDifyDocument } from "./normalize.js"
import { parseYamlDocument } from "./yaml.js"

export function parseDifyWorkflow(source: string): NormalizedDifyWorkflow {
  return normalizeDifyDocument(parseYamlDocument(source))
}
