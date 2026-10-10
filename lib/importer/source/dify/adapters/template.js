import { normalizeNode, supportsType } from "./shared.js";
export const templateAdapter = { supports: (node) => supportsType(node, ["template-transform"]), normalize: (node, context) => normalizeNode(node, context, "template") };
//# sourceMappingURL=template.js.map