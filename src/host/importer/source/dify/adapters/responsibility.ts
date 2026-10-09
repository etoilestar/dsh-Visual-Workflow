import type { SourceNodeAdapter } from "../../registry.js"
import { normalizeNode, supportsType } from "./shared.js"
export const llmAdapter: SourceNodeAdapter = { supports: (node) => supportsType(node, ["llm"]), normalize: (node, context) => normalizeNode(node, context, "llm") }
export const agentAdapter: SourceNodeAdapter = { supports: (node) => supportsType(node, ["agent"]), normalize: (node, context) => normalizeNode(node, context, "agent") }
