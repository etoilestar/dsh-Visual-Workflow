function isResponsibilityNode(node) {
    return node.kind === "agent" || node.kind === "group";
}
function responsibilityOf(node) {
    if (node.kind === "parent")
        return undefined;
    const value = node.data.responsibility;
    return value && typeof value === "object" ? value : undefined;
}
function comparablePurpose(value) {
    return value
        .toLocaleLowerCase()
        .replace(/搜索/g, "检索")
        .replace(/论文/g, "文献")
        .replace(/相关|有关|负责|进行|并|和|与/g, "")
        .replace(/[\s\p{P}\p{S}]+/gu, "");
}
function bigrams(value) {
    if (value.length < 2)
        return new Set(value ? [value] : []);
    return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}
function purposeSimilarity(left, right) {
    const a = comparablePurpose(left);
    const b = comparablePurpose(right);
    if (!a || !b)
        return 0;
    if (a === b)
        return 1;
    const aPairs = bigrams(a);
    const bPairs = bigrams(b);
    let overlap = 0;
    for (const pair of aPairs)
        if (bPairs.has(pair))
            overlap += 1;
    return (2 * overlap) / (aPairs.size + bPairs.size);
}
/** 检查规划责任的完整性、重复性，以及调用方可选提供的需求覆盖范围。 */
export function ruleNodeResponsibilities(input) {
    const nodes = (input.flow.nodes ?? []).filter(isResponsibilityNode);
    const issues = [];
    for (const node of nodes) {
        const responsibility = responsibilityOf(node);
        const purpose = String(responsibility?.purpose ?? "").trim();
        if (!purpose) {
            issues.push({
                code: "responsibilityMissing",
                level: "warning",
                message: `节点「${node.data.label || node.id}」缺少核心职责，无法解释为什么需要该节点。`,
                nodeIds: [node.id],
                suggestion: "补充 data.responsibility.id 与 purpose，并用 requirementRefs 记录对应的需求来源。",
            });
        }
        else if (!String(responsibility?.deliverable ?? "").trim()) {
            issues.push({
                code: "responsibilityDeliverableMissing",
                level: "warning",
                message: `节点「${node.data.label || node.id}」已有职责，但没有说明应产出什么结果。`,
                nodeIds: [node.id],
                suggestion: "在 data.responsibility.deliverable 中补充可供下游消费的产出。",
            });
        }
    }
    for (let left = 0; left < nodes.length; left += 1) {
        const leftNode = nodes[left];
        if (!leftNode)
            continue;
        const leftPurpose = String(responsibilityOf(leftNode)?.purpose ?? "").trim();
        if (!leftPurpose)
            continue;
        for (let right = left + 1; right < nodes.length; right += 1) {
            const rightNode = nodes[right];
            if (!rightNode)
                continue;
            const rightPurpose = String(responsibilityOf(rightNode)?.purpose ?? "").trim();
            if (!rightPurpose || purposeSimilarity(leftPurpose, rightPurpose) < 0.72)
                continue;
            issues.push({
                code: "responsibilityDuplicate",
                level: "warning",
                message: `节点「${leftNode.data.label || leftNode.id}」与「${rightNode.data.label || rightNode.id}」的职责高度相似，可能存在重复。`,
                nodeIds: [leftNode.id, rightNode.id],
                suggestion: "确认两者职责边界；仅在确属重复时由规划者决定是否调整，不自动合并或删除节点。",
            });
        }
    }
    const covered = new Set(nodes.flatMap((node) => responsibilityOf(node)?.requirementRefs ?? []).map((ref) => ref.trim()).filter(Boolean));
    for (const requirement of input.requirementRefs ?? []) {
        const normalized = String(requirement).trim();
        if (!normalized || covered.has(normalized))
            continue;
        issues.push({
            code: "requirementUncovered",
            level: "warning",
            message: `需求「${normalized}」尚未被任何节点的 responsibility.requirementRefs 覆盖。`,
            suggestion: "把需求引用分配给承担该目标的现有节点；只有职责确实独立时才新增节点。",
        });
    }
    return issues;
}
//# sourceMappingURL=invariants-rules-responsibility.js.map