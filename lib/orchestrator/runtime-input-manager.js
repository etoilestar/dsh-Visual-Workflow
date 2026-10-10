import { inputRequirementsOf, mainNodeIdOf, nodeById, runtimeDefinitionOf } from "../graph/index.js";
import { executionOf } from "./execution-inputs.js";
import { WfError } from "./errors.js";
import { findResumableRun } from "./resume.js";
import { RuntimeBase } from "./runtime-base.js";
import { runtimeInputsOf } from "./runtime-inputs.js";
function policyOf(value) {
    if (value === "explicit" || value === "auto" || value === "strict")
        return value;
    throw new WfError("handoffPolicy 必须为 explicit/auto/strict", "WF_RUNTIME_INPUT_INVALID", { details: [{ field: "handoffPolicy", message: "策略无效" }], retryable: false });
}
export class RuntimeInputManager extends RuntimeBase {
    async authorizeInputs(raw, flow, snapshot) {
        return runtimeInputsOf(raw, flow, { cwd: snapshot.workingDirectory, managedRoot: this.deps.store.root, files: await this.deps.sessionInputFiles?.(snapshot.sessionId) ?? [] });
    }
    async prepareRuntimeInputs(flow, snapshot, raw, policy) {
        let definition;
        try {
            definition = runtimeDefinitionOf(flow.runtime);
        }
        catch (error) {
            throw new WfError(String(error), "WF_EXECUTION_CONTRACT_INVALID", { retryable: false });
        }
        if (raw !== undefined || snapshot.runtimeInputs !== undefined || definition !== undefined || policy !== undefined) {
            snapshot.runtimeInputs = await this.authorizeInputs(raw ?? snapshot.runtimeInputs ?? {}, flow, snapshot);
            snapshot.inputRevision = (snapshot.inputRevision ?? 0) + (raw !== undefined || snapshot.inputRevision === undefined ? 1 : 0);
            snapshot.handoffPolicy = policyOf(policy ?? snapshot.handoffPolicy ?? definition?.handoffPolicy ?? "explicit");
            snapshot.budget ??= definition?.budget ? structuredClone(definition.budget) : undefined;
            for (const [name, requirement] of Object.entries(definition?.inputs ?? {})) {
                const values = snapshot.runtimeInputs.workflowInputs[name];
                if (requirement.required !== false && !values?.length)
                    throw new WfError(`缺少工作流输入：${name}`, "WF_INPUT_REQUIRED", { phase: "node_input", retryable: false, details: [{ field: `workflowInputs.${name}`, message: "需要用户提供" }] });
                if (requirement.kind && values?.some((value) => value.kind !== "output" && value.kind !== requirement.kind))
                    throw new WfError(`工作流输入类型不符：${name}`, "WF_RUNTIME_INPUT_INVALID", { retryable: false });
            }
            this.traceRuntime(snapshot, "input_validated", "accepted", { inputNames: Object.keys(snapshot.runtimeInputs.workflowInputs) });
        }
    }
    async runtimeInputOptions(input) {
        const flow = await this.deps.store.getWorkflow(input.sessionId, input.flowId);
        if (!flow)
            throw new WfError("工作流不存在", "WF_NOT_FOUND");
        const definition = runtimeDefinitionOf(flow.runtime);
        const checkpoint = await findResumableRun(this.deps.store, input);
        const nodeInputs = {};
        for (const node of flow.nodes)
            if (node.kind === "agent" || node.kind === "parent")
                nodeInputs[node.id] = inputRequirementsOf(executionOf(node).inputs);
        return { workflowInputs: definition?.inputs ?? {}, nodeInputs, files: [...await this.deps.sessionInputFiles?.(input.sessionId) ?? []], handoffPolicy: checkpoint?.handoffPolicy ?? definition?.handoffPolicy ?? "explicit", workingDirectory: await this.deps.workingDirectory?.(input.sessionId), ...(checkpoint ? { checkpoint: { runId: checkpoint.id, runtimeInputs: checkpoint.runtimeInputs, handoffPolicy: checkpoint.handoffPolicy } } : {}) };
    }
    /** Binding reserves the same dispatch window and publishes only after a strict durable write. */
    async bindRuntimeInputs(input) {
        const entry = this.runs.get(input.runId);
        if (!entry || entry.snapshot.sessionId !== input.sessionId)
            throw new WfError("运行不存在", "WF_NOT_FOUND");
        if (entry.inputBinding || entry.dispatching?.size)
            throw new WfError("输入绑定或节点派发尚未完成", "WF_BUSY");
        const assertCurrent = () => {
            if (this.runs.get(input.runId) !== entry || entry.controller.signal.aborted || !["running", "paused"].includes(entry.snapshot.status))
                throw new WfError("运行代际已失效", "WF_CANCELLED");
            if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== (entry.snapshot.inputRevision ?? 0))
                throw new WfError("输入版本已变化，请刷新后重新绑定", "WF_INPUT_REVISION_CONFLICT");
        };
        assertCurrent();
        entry.inputBinding = true;
        let release;
        entry.inputBindingDone = new Promise((resolve) => { release = resolve; });
        try {
            const flow = await this.currentResolvedFlow(entry);
            assertCurrent();
            const canonical = input.nodeId === undefined ? undefined : mainNodeIdOf(flow, input.nodeId) ?? input.nodeId;
            const targets = canonical === undefined ? flow.nodes.filter((node) => node.kind === "agent" || node.kind === "parent") : [nodeById(flow, canonical)];
            if (!targets.length || targets.some((node) => !node || node.kind !== "agent" && node.kind !== "parent" || entry.snapshot.nodes.find((record) => record.nodeId === node.id)?.status !== "pending" || (entry.snapshot.nodes.find((record) => record.nodeId === node.id)?.attempts ?? 0) !== 0))
                throw new WfError("只能绑定尚未派发的执行节点；工作流级变更需要所有执行节点尚未派发", "WF_INPUT_STATE_CONFLICT");
            const raw = canonical === undefined ? input.inputs : { ...structuredClone(entry.snapshot.runtimeInputs ?? { workflowInputs: {}, nodeInputs: {} }), nodeInputs: { ...entry.snapshot.runtimeInputs?.nodeInputs, [canonical]: input.inputs } };
            const inputs = await this.authorizeInputs(raw, flow, entry.snapshot);
            assertCurrent();
            const next = structuredClone(entry.snapshot);
            next.runtimeInputs = inputs;
            next.inputRevision = input.expectedRevision + 1;
            this.traceRuntime(next, "input_bound", "accepted", { nodeId: canonical, inputNames: Object.keys(canonical ? inputs.nodeInputs[canonical] : inputs.workflowInputs) });
            await this.deps.store.saveRun(next);
            assertCurrent();
            entry.snapshot.runtimeInputs = inputs;
            entry.snapshot.inputRevision = next.inputRevision;
            // Other children may settle during authorization; retain their current state and events.
            this.traceRuntime(entry.snapshot, "input_bound", "accepted", { nodeId: canonical, inputNames: Object.keys(canonical ? inputs.nodeInputs[canonical] : inputs.workflowInputs) });
            try {
                await this.deps.store.saveRun(entry.snapshot);
            }
            catch (error) {
                this.warn(`输入已持久化，最新结算状态写入失败：${String(error)}`);
            }
            return structuredClone(entry.snapshot);
        }
        finally {
            entry.inputBinding = false;
            delete entry.inputBindingDone;
            release();
        }
    }
}
//# sourceMappingURL=runtime-input-manager.js.map