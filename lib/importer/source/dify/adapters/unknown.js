import { normalizeNode, readDifyNode } from "./shared.js";
export const unknownAdapter = { supports: (node) => readDifyNode(node) !== undefined, normalize: (node, context) => normalizeNode(node, context, "unknown") };
//# sourceMappingURL=unknown.js.map