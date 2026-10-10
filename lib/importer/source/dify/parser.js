import { normalizeDifyDocument } from "./normalize.js";
import { parseYamlDocument } from "./yaml.js";
export function parseDifyWorkflow(source) {
    return normalizeDifyDocument(parseYamlDocument(source));
}
//# sourceMappingURL=parser.js.map