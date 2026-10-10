import type { WorkflowDocument } from "../shared/graph-model.js";
import type { RuntimeInputOptions, RuntimeInputs } from "../shared/runtime-types.js";
import type { RunSnapshot } from "../shared/types.js";
import { RuntimeBase } from "./runtime-base.js";
export declare abstract class RuntimeInputManager extends RuntimeBase {
    protected authorizeInputs(raw: unknown, flow: WorkflowDocument, snapshot: Pick<RunSnapshot, "sessionId" | "workingDirectory">): Promise<RuntimeInputs>;
    protected prepareRuntimeInputs(flow: WorkflowDocument, snapshot: RunSnapshot, raw?: unknown, policy?: unknown): Promise<void>;
    runtimeInputOptions(input: {
        sessionId: string;
        flowId: string;
    }): Promise<RuntimeInputOptions>;
    /** Binding reserves the same dispatch window and publishes only after a strict durable write. */
    bindRuntimeInputs(input: {
        sessionId: string;
        runId: string;
        expectedRevision: number;
        nodeId?: string;
        inputs: unknown;
    }): Promise<RunSnapshot>;
}
