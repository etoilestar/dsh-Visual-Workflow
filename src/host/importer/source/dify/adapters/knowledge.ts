import type { SourceNodeAdapter } from "../../registry.js"
import { normalizeNode, readDifyNode, supportsType } from "./shared.js"
import { referenceInputs } from "../variables.js"
export const knowledgeAdapter: SourceNodeAdapter = { supports: (node) => supportsType(node, ["knowledge-retrieval"]), normalize: (node, context) => {
  const data = readDifyNode(node)?.data ?? {}
  return normalizeNode(node, context, "knowledge", { inputs: referenceInputs(data) })
} }
