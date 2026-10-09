import { toolAdapter, httpAdapter, codeAdapter } from "./capability.js";
import { conditionAdapter, iterationAdapter, loopAdapter } from "./control.js";
import { endAdapter } from "./end.js";
import { knowledgeAdapter } from "./knowledge.js";
import { agentAdapter, llmAdapter } from "./responsibility.js";
import { startAdapter } from "./start.js";
import { templateAdapter } from "./template.js";
import { unknownAdapter } from "./unknown.js";
export function createDifyAdapters() { return [startAdapter, endAdapter, llmAdapter, agentAdapter, toolAdapter, knowledgeAdapter, conditionAdapter, httpAdapter, templateAdapter, codeAdapter, loopAdapter, iterationAdapter, unknownAdapter]; }
//# sourceMappingURL=index.js.map