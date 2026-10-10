import { normalizeNode, supportsType } from "./shared.js";
export const llmAdapter = { supports: (node) => supportsType(node, ["llm"]), normalize: (node, context) => normalizeNode(node, context, "llm") };
export const agentAdapter = { supports: (node) => supportsType(node, ["agent"]), normalize: (node, context) => normalizeNode(node, context, "agent") };
//# sourceMappingURL=responsibility.js.map