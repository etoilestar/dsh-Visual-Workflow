import { WfError } from "./errors.js";
import type { RunEntry, RunNodeArgs, RunNodeResult } from "./run-entry.js";
import type { CallerInfo } from "./seams.js";
import { RuntimeLifecycle } from "./runtime-lifecycle.js";
export declare class RuntimeGovernance extends RuntimeLifecycle {
    parentToolDenial(caller: CallerInfo, name: string, args: unknown): WfError | undefined;
    authorizeParentTool(caller: CallerInfo, name: string, args: unknown): Promise<void>;
    recordParentToolResult(caller: CallerInfo, name: string, error?: unknown): Promise<void>;
    enforceRuntimeBudget(entry: RunEntry): Promise<void>;
    private failBudget;
    cancelParentForBudget(entry: RunEntry): void;
    wfRunNode(caller: CallerInfo, args: RunNodeArgs, signal?: AbortSignal, options?: {
        expectedMode?: "mode1" | "mode2";
    }): Promise<RunNodeResult>;
}
