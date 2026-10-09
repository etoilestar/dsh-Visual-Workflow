import type { SourceNodeAdapter } from "../../registry.js"
import { normalizeNode, supportsType } from "./shared.js"
export const endAdapter: SourceNodeAdapter = { supports: (node) => supportsType(node, ["answer", "end"]), normalize: (node, context) => normalizeNode(node, context, "end", { outputs: [] }) }
