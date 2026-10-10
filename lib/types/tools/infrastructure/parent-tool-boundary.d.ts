import type { OrchestratorRuntime } from "../../orchestrator/index.js";
import type { ToolExecLike } from "./define-tool.js";
export interface ParentToolExecution extends ToolExecLike {
    name?: unknown;
    arguments?: unknown;
}
export type ParentToolDecision = {
    kind: "allow";
} | {
    kind: "deny";
    reason: string;
    info?: {
        name: string;
        code: string;
    };
} | {
    kind: "cancel";
} | {
    kind: "ask";
    reason?: string;
};
/** Both native calls and PTC subcalls cross this public host pipeline. The guard cannot force-allow. */
export declare function registerParentToolBoundary(ctx: {
    get(name: string): unknown;
    on(name: "tools/pre-execute", handler: (exec: ParentToolExecution, next: () => Promise<ParentToolDecision>) => Promise<ParentToolDecision>): () => void;
    on(name: "tools/result", handler: (exec: ParentToolExecution, result: {
        isError?: unknown;
        error?: unknown;
    }) => void): () => void;
}, runtime: OrchestratorRuntime): () => void;
