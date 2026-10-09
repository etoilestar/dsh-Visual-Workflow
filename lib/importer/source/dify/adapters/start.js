import { normalizeNode, startOutputs, supportsType } from "./shared.js";
export const startAdapter = { supports: (node) => supportsType(node, ["start"]), normalize: (node, context) => normalizeNode(node, context, "start", { inputs: [], outputs: startOutputs(node) }) };
//# sourceMappingURL=start.js.map