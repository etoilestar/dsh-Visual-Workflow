const ISSUE_TYPES = new Set([
    "requirement_uncovered",
    "requirement_partially_covered",
    "responsibility_overlap",
    "dataflow_semantic_mismatch",
]);
export function buildSemanticWorkflowView(flow) {
    return {
        nodes: (flow.nodes ?? []).map((node) => semanticNodeView(node)),
        lines: (flow.lines ?? []).map((line) => semanticLineView(line)),
    };
}
function semanticNodeView(node) {
    const data = "data" in node && node.data && typeof node.data === "object" ? node.data : {};
    const view = { id: node.id, kind: node.kind };
    for (const key of ["label", "systemPrompt", "outputSchema", "collabPrompt", "memberIds"]) {
        if (data[key] !== undefined)
            view[key] = data[key];
    }
    if (node.kind === "proxy")
        view.proxySourceId = node.proxySourceId;
    return view;
}
function semanticLineView(line) {
    const channel = line.sourceHandle === "db-out" || line.targetHandle === "db-in"
        ? "db"
        : line.sourceHandle === "ctx-out" || line.targetHandle === "ctx-in" ? "ctx" : "flow";
    return {
        source: line.source,
        target: line.target,
        channel,
        ...(line.condition ? { condition: line.condition } : {}),
    };
}
export const SEMANTIC_REVIEWER_PROMPT = `你是只读 workflow semantic reviewer；你没有设计该 workflow，也不能返回 graph patch。
Requirement source authority：所有 requirement 只能来自 originalUserIntent。创建 requirement 前必须能指出是哪条原始意图证明它存在；不能证明就不要创建。workflow 仅是实现证据，不能反推出需求。
只检查 requirement_uncovered、requirement_partially_covered、responsibility_overlap、dataflow_semantic_mismatch。职责轻微交叉不算 overlap，只有核心业务责任高度重叠才报告，且 responsibility_overlap 必须为 warning；其他三类明确问题为 error。
dataflow 只把 ctx、db 或明确 outputSchema 当作真实数据交接；普通 flow 线只代表顺序，不能当数据传输。
禁止重新设计 workflow，禁止仅为最佳实践要求 validator、retry、synchronizer、feedback loop、aggregator 或额外 robustness mechanism，除非原始需求明确要求。
SUFFICIENCY STOP RULE：明确需求已覆盖、核心职责无明显冲突、必要数据交接成立就 PASS，不继续寻找可优化项。
只输出严格 JSON：{"passed":boolean,"requirements":[{"id":string,"text":string,"ownerNodeIds":string[]}],"issues":[{"type":string,"level":"error"|"warning","requirementIds":string[],"affectedNodeIds":string[],"reason":string,"evidence":string,"repairGuidance":string}]}。passed=true 时不得有 error。requirement id 必须唯一，所有节点 id 必须来自 workflow。`;
export class SemanticReviewer {
    runtime;
    constructor(runtime) {
        this.runtime = runtime;
    }
    async review(originalUserIntent, flow) {
        const modelService = typeof this.runtime.agentDefaultModel === "function"
            ? this.runtime.agentDefaultModel()
            : this.runtime.agentDefaultModel;
        const llm = typeof this.runtime.llm === "function" ? this.runtime.llm() : this.runtime.llm;
        const selection = modelService?.currentSelection();
        if (!selection || !llm)
            return this.unavailable("LLM 或默认模型服务不可用");
        const input = JSON.stringify({ originalUserIntent, workflow: buildSemanticWorkflowView(flow) });
        let protocolError = "";
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const content = await collectText(llm.stream({
                    provider: selection.provider,
                    model: selection.model,
                    messages: [
                        { role: "system", content: SEMANTIC_REVIEWER_PROMPT },
                        { role: "user", content: attempt === 0 ? input : `只修复上一响应的 JSON protocol shape，不改变语义判断。原始输入：${input}\n协议错误：${protocolError}` },
                    ],
                }));
                return { available: true, result: parseSemanticReview(content, flow) };
            }
            catch (error) {
                protocolError = error instanceof Error ? error.message : String(error);
            }
        }
        return this.unavailable(`semantic reviewer protocol 连续两次无效：${protocolError}`);
    }
    unavailable(reason) {
        this.runtime.logger?.error(`[visual-workflow] semantic review unavailable: ${reason}`);
        return { available: false, unavailableReason: reason };
    }
}
async function collectText(stream) {
    let text = "";
    for await (const chunk of stream)
        text += textOfChunk(chunk);
    return text.trim();
}
function textOfChunk(chunk) {
    if (typeof chunk === "string")
        return chunk;
    if (!chunk || typeof chunk !== "object")
        return "";
    const value = chunk;
    if (typeof value.text === "string")
        return value.text;
    if (typeof value.delta === "string")
        return value.delta;
    if (typeof value.content === "string")
        return value.content;
    const delta = value.delta;
    return typeof delta?.content === "string" ? delta.content : "";
}
export function parseSemanticReview(text, flow) {
    const value = JSON.parse(text.trim());
    assertOnlyKeys(value, ["passed", "requirements", "issues"], "response");
    if (typeof value.passed !== "boolean" || !Array.isArray(value.requirements) || !Array.isArray(value.issues)) {
        throw new Error("响应缺少 passed/requirements/issues");
    }
    const nodeIds = new Set((flow.nodes ?? []).map((node) => node.id));
    const requirements = value.requirements.map((raw) => {
        const item = objectOf(raw, "requirement");
        assertOnlyKeys(item, ["id", "text", "ownerNodeIds"], "requirement");
        const id = requiredString(item.id, "requirement.id");
        return { id, text: requiredString(item.text, "requirement.text"), ownerNodeIds: nodeIdArray(item.ownerNodeIds, nodeIds, "ownerNodeIds") };
    });
    const requirementIds = new Set(requirements.map((item) => item.id));
    if (requirementIds.size !== requirements.length)
        throw new Error("requirement id 必须唯一");
    const issues = value.issues.map((raw) => parseIssue(raw, nodeIds, requirementIds));
    if (value.passed && issues.some((issue) => issue.level === "error"))
        throw new Error("passed=true 不能包含 error");
    if (!value.passed && !issues.some((issue) => issue.level === "error"))
        throw new Error("passed=false 必须包含 error");
    return { passed: value.passed, requirements, issues };
}
function parseIssue(raw, nodeIds, requirementIds) {
    const item = objectOf(raw, "issue");
    assertOnlyKeys(item, ["type", "level", "requirementIds", "affectedNodeIds", "reason", "evidence", "repairGuidance"], "issue");
    const type = String(item.type ?? "");
    if (!ISSUE_TYPES.has(type))
        throw new Error(`未知 issue type: ${type}`);
    const level = item.level;
    if (level !== "error" && level !== "warning")
        throw new Error("未知 issue level");
    if ((type === "responsibility_overlap") !== (level === "warning"))
        throw new Error(`${type} 的 level 不符合策略`);
    const refs = stringArray(item.requirementIds, "requirementIds");
    if (refs.some((id) => !requirementIds.has(id)))
        throw new Error("issue 引用了未知 requirement");
    return {
        type,
        level,
        requirementIds: refs,
        affectedNodeIds: nodeIdArray(item.affectedNodeIds, nodeIds, "affectedNodeIds"),
        reason: requiredString(item.reason, "reason"),
        evidence: requiredString(item.evidence, "evidence"),
        repairGuidance: requiredString(item.repairGuidance, "repairGuidance"),
    };
}
function objectOf(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${label} 必须是对象`);
    return value;
}
function assertOnlyKeys(value, keys, label) {
    const unknown = Object.keys(value).filter((key) => !keys.includes(key));
    if (unknown.length > 0)
        throw new Error(`${label} 含未知字段：${unknown.join(",")}`);
}
function requiredString(value, label) {
    const out = typeof value === "string" ? value.trim() : "";
    if (!out)
        throw new Error(`${label} 必须是非空字符串`);
    return out;
}
function stringArray(value, label) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
        throw new Error(`${label} 必须是字符串数组`);
    return value;
}
function nodeIdArray(value, nodeIds, label) {
    const ids = stringArray(value, label);
    if (ids.some((id) => !nodeIds.has(id)))
        throw new Error(`${label} 引用了 candidate 中不存在的节点`);
    return ids;
}
//# sourceMappingURL=reviewer.js.map