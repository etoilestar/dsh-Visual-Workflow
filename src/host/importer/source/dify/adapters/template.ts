import type { SourceNodeAdapter } from "../../registry.js"
import { normalizeNode, supportsType } from "./shared.js"
export const templateAdapter: SourceNodeAdapter = { supports: (node) => supportsType(node, ["template-transform"]), normalize: (node, context) => normalizeNode(node, context, "template") }
