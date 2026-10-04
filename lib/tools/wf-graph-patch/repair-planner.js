import { findNodeByResponsibilityId, responsibilityRepairScopeOf } from "../../graph/index.js";
function flowLineById(flow, lineId) {
    const line = flow.lines.find((item) => item.id === lineId);
    if (!line || line.sourceHandle !== "flow-out" || line.targetHandle !== "flow-in" || line.condition)
        return null;
    return line;
}
function insertedNodeId(node) {
    return String(node.id ?? "").trim();
}
/**
 * 生成待用户确认的局部 wf_graph_patch proposal；本函数不写图也不调用工具。
 * 无法唯一定位责任或无法证明操作局部时返回 null，避免退化为整图重建。
 */
export function planResponsibilityRepair(input) {
    const lookup = findNodeByResponsibilityId(input.workflow, input.targetResponsibilityId);
    const repairScope = responsibilityRepairScopeOf(input.workflow, input.targetResponsibilityId);
    if (!lookup || !repairScope)
        return null;
    const allNodeIds = input.workflow.nodes.map((node) => node.id);
    const allLineIds = input.workflow.lines.map((line) => line.id);
    let scope;
    let ops;
    if (input.change.kind === "update_node") {
        scope = "small";
        ops = [{ op: "update_node_data", nodeId: lookup.nodeId, data: { ...input.change.data } }];
    }
    else if (input.change.kind === "insert_node") {
        const nodeId = insertedNodeId(input.change.node);
        const replaced = flowLineById(input.workflow, input.change.replaceLineId);
        const kind = String(input.change.node.kind ?? "");
        if (!nodeId || allNodeIds.includes(nodeId) || !replaced || (replaced.source !== lookup.nodeId && replaced.target !== lookup.nodeId))
            return null;
        if (kind !== "agent" && kind !== "group")
            return null;
        const before = replaced.target === lookup.nodeId;
        const upstream = before ? replaced.source : lookup.nodeId;
        const downstream = before ? lookup.nodeId : replaced.target;
        scope = "medium";
        ops = [
            { op: "create_node", node: { ...input.change.node } },
            { op: "disconnect", lineId: replaced.id },
            { op: "connect", source: upstream, target: nodeId, sourceHandle: "flow-out", targetHandle: "flow-in" },
            { op: "connect", source: nodeId, target: downstream, sourceHandle: "flow-out", targetHandle: "flow-in" },
        ];
    }
    else {
        const localLineIds = new Set([...repairScope.incomingLineIds, ...repairScope.outgoingLineIds]);
        const neighborIds = new Set([lookup.nodeId]);
        for (const line of input.workflow.lines) {
            if (!localLineIds.has(line.id))
                continue;
            neighborIds.add(line.source);
            neighborIds.add(line.target);
        }
        if (input.change.disconnectLineIds.some((lineId) => !localLineIds.has(lineId)))
            return null;
        if (input.change.connections.some((connection) => !neighborIds.has(connection.source) || !neighborIds.has(connection.target)))
            return null;
        scope = "large";
        ops = [
            ...input.change.disconnectLineIds.map((lineId) => ({ op: "disconnect", lineId })),
            ...input.change.connections.map((connection) => ({ ...connection })),
        ];
    }
    const changedExistingLines = new Set(ops.flatMap((op) => op.op === "disconnect" && op.lineId ? [op.lineId] : []));
    return {
        targetResponsibilityId: lookup.responsibility.id,
        targetNodeId: lookup.nodeId,
        scope,
        warning: {
            ...input.warning,
            nodeIds: [...input.warning.nodeIds],
            responsibilityIds: [...input.warning.responsibilityIds],
        },
        ops,
        preservedNodeIds: allNodeIds.filter((nodeId) => nodeId !== lookup.nodeId),
        preservedLineIds: allLineIds.filter((lineId) => !changedExistingLines.has(lineId)),
        requiresConfirmation: true,
    };
}
//# sourceMappingURL=repair-planner.js.map