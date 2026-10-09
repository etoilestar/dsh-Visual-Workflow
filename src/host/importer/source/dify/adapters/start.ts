import type { SourceNodeAdapter } from "../../registry.js"
import { normalizeNode, startOutputs, supportsType } from "./shared.js"
export const startAdapter: SourceNodeAdapter = { supports: (node) => supportsType(node, ["start"]), normalize: (node, context) => normalizeNode(node, context, "start", { inputs: [], outputs: startOutputs(node) }) }
