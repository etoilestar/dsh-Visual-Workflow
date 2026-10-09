import type { SourceNodeAdapter } from "../../registry.js"
import { normalizeNode, supportsType } from "./shared.js"
export const toolAdapter: SourceNodeAdapter = { supports: (node) => supportsType(node, ["tool"]), normalize: (node, context) => normalizeNode(node, context, "tool") }
export const httpAdapter: SourceNodeAdapter = { supports: (node) => supportsType(node, ["http-request", "http"]), normalize: (node, context) => normalizeNode(node, context, "http") }
export const codeAdapter: SourceNodeAdapter = { supports: (node) => supportsType(node, ["code"]), normalize: (node, context) => normalizeNode(node, context, "code") }
