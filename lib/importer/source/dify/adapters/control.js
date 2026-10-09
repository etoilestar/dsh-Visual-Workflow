import { normalizeNode, supportsType } from "./shared.js";
export const conditionAdapter = { supports: (node) => supportsType(node, ["condition", "if-else"]), normalize: (node, context) => normalizeNode(node, context, "condition") };
export const loopAdapter = { supports: (node) => supportsType(node, ["loop"]), normalize: (node, context) => normalizeNode(node, context, "loop") };
export const iterationAdapter = { supports: (node) => supportsType(node, ["iteration"]), normalize: (node, context) => normalizeNode(node, context, "iteration") };
//# sourceMappingURL=control.js.map