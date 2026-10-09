import { normalizeNode, supportsType } from "./shared.js";
export const toolAdapter = { supports: (node) => supportsType(node, ["tool"]), normalize: (node, context) => normalizeNode(node, context, "tool") };
export const httpAdapter = { supports: (node) => supportsType(node, ["http-request", "http"]), normalize: (node, context) => normalizeNode(node, context, "http") };
export const codeAdapter = { supports: (node) => supportsType(node, ["code"]), normalize: (node, context) => normalizeNode(node, context, "code") };
//# sourceMappingURL=capability.js.map