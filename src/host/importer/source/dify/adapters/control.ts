import type { SourceNodeAdapter } from "../../registry.js"
import { normalizeNode, supportsType } from "./shared.js"
export const conditionAdapter: SourceNodeAdapter = { supports: (node) => supportsType(node, ["condition", "if-else"]), normalize: (node, context) => normalizeNode(node, context, "condition") }
export const loopAdapter: SourceNodeAdapter = { supports: (node) => supportsType(node, ["loop"]), normalize: (node, context) => normalizeNode(node, context, "loop") }
export const iterationAdapter: SourceNodeAdapter = { supports: (node) => supportsType(node, ["iteration"]), normalize: (node, context) => normalizeNode(node, context, "iteration") }
