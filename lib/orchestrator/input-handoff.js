import { ctxInEdges, isFlowLine, isGroupMember, mainNodeIdOf, nodeById } from "../graph/index.js";
import { WfError } from "./errors.js";
import { executionOf, verifyNodeArtifacts } from "./execution-inputs.js";
import { authorizedOutputPath, outputSignature } from "./execution-file-access.js";
/** Workflow inputs belong to one initial Agent, never to every node or an arbitrary branch. */
export function workflowInputTarget(flow) {
    const idOf = (id) => mainNodeIdOf(flow, id) ?? id;
    const candidates = flow.nodes.filter((node) => {
        if (node.kind !== "agent" || isGroupMember(flow, node.id))
            return false;
        const incoming = flow.lines.filter(isFlowLine).filter((line) => idOf(line.target) === node.id);
        return incoming.length > 0 && incoming.every((line) => !line.condition && nodeById(flow, idOf(line.source))?.kind === "start");
    });
    if (candidates.length !== 1)
        throw new WfError("工作流输入没有唯一初始 Agent；请明确绑定到指定节点", "WF_INPUT_AMBIGUOUS");
    return candidates[0].id;
}
export function boundNodeInputs(snapshot, nodeId) {
    return { ...(snapshot.workflowInputNodeId === nodeId ? snapshot.runtimeInputs?.workflowInputs : {}), ...snapshot.runtimeInputs?.nodeInputs[nodeId] };
}
/** Automatic handoff is limited to a unique unconditional direct Agent predecessor. */
export async function effectiveNodeInputs(flow, node, snapshot) {
    const bound = boundNodeInputs(snapshot, node.id);
    // Existing ctx always wins. User node bindings deliberately replace automatic input.
    if (snapshot.handoffPolicy !== "auto" || ctxInEdges(flow, node.id).length || Object.values(bound).some((values) => values.length))
        return bound;
    const idOf = (id) => mainNodeIdOf(flow, id) ?? id;
    const lines = flow.lines.filter(isFlowLine);
    const incoming = lines.filter((line) => idOf(line.target) === node.id);
    if (!incoming.length || incoming.every((line) => !line.condition && nodeById(flow, idOf(line.source))?.kind === "start"))
        return bound;
    const sources = [...new Set(incoming.map((line) => idOf(line.source)))];
    const source = sources.length === 1 ? nodeById(flow, sources[0]) : undefined;
    const reachable = new Set([node.id]);
    for (const id of reachable)
        for (const line of lines)
            if (idOf(line.source) === id)
                reachable.add(idOf(line.target));
    if (isGroupMember(flow, node.id) || source?.kind !== "agent" || isGroupMember(flow, source.id) || incoming.some((line) => line.condition) || reachable.has(source.id)) {
        throw new WfError(`节点 ${node.id} 的自动交接来源不确定；请绑定输入或使用显式 ctx`, "WF_INPUT_AMBIGUOUS");
    }
    const record = snapshot.nodes.find((entry) => entry.nodeId === source.id);
    const attempt = record?.attemptHistory?.at(-1);
    if (!record || !["ok", "react-capped"].includes(record.status) || !record.attempts || attempt?.attempt !== record.attempts || attempt.phase !== "settled" || attempt.status !== record.status) {
        throw new WfError(`上游 ${source.id} 尚无有效结算；请等待结算或处理失败后重试`, "WF_INPUT_UPSTREAM_UNAVAILABLE");
    }
    const inputs = {};
    const origin = { source: "node", nodeId: source.id, runId: attempt.runId ?? snapshot.id, attempt: record.attempts };
    if (record.output.trim() && record.output !== "(子代理已完成，但无可汇总文本)")
        inputs.upstreamText = [{ kind: "text", value: record.output, origin }];
    // Reuse the original existence/current-write evidence check without mutating the source snapshot.
    const checked = structuredClone(snapshot);
    await verifyNodeArtifacts(source, checked, Date.now());
    const verified = executionOf(source).outputFiles?.length ? checked.nodes.find((entry) => entry.nodeId === source.id)?.artifacts ?? [] : [];
    for (const artifact of verified) {
        const settled = record.artifacts?.find((entry) => entry.path === artifact.path);
        if (settled?.signature && (settled.attempt !== record.attempts || settled.nodeId !== source.id || (!record.resumed && settled.runId !== snapshot.id)
            || (await outputSignature(await authorizedOutputPath(artifact.path, snapshot.workingDirectory)))?.signature !== settled.signature)) {
            throw new WfError(`上游 ${source.id} 的文件已变化或属于旧尝试；请重新执行`, "WF_OUTPUT_FILE_STALE");
        }
    }
    if (verified.length)
        inputs.upstreamFiles = verified.map((artifact) => ({ kind: "file", fileRef: { source: "node", path: artifact.path }, origin }));
    if (!Object.keys(inputs).length)
        throw new WfError(`上游 ${source.id} 没有可交接的文本或已验证文件`, "WF_INPUT_UPSTREAM_UNAVAILABLE");
    return inputs;
}
//# sourceMappingURL=input-handoff.js.map