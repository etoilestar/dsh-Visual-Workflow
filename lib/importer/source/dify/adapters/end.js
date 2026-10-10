import { normalizeNode, supportsType } from "./shared.js";
export const endAdapter = { supports: (node) => supportsType(node, ["answer", "end"]), normalize: (node, context) => normalizeNode(node, context, "end", { outputs: [] }) };
//# sourceMappingURL=end.js.map