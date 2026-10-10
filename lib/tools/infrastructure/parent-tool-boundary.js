import { callerOf } from "./caller.js";
/** Both native calls and PTC subcalls cross this public host pipeline. The guard cannot force-allow. */
export function registerParentToolBoundary(ctx, runtime) {
    const disposers = [];
    const tools = ctx.get("tools");
    if (typeof tools?.guard === "function")
        disposers.push(tools.guard((exec) => {
            const error = runtime.parentToolDenial(callerOf(exec), String(exec.name ?? ""), exec.arguments);
            return error ? `${error.code}: ${error.message}` : undefined;
        }));
    else
        runtime.warn("宿主无公开 tools.guard；使用 tools/pre-execute 拒绝纯编排业务调用");
    disposers.push(ctx.on("tools/pre-execute", async (exec, next) => {
        try {
            await runtime.authorizeParentTool(callerOf(exec), String(exec.name ?? ""), exec.arguments);
        }
        catch (cause) {
            const error = cause;
            return { kind: "deny", reason: String(error.message ?? "Workflow 工具调用已拒绝"), info: { name: "WorkflowPolicyError", code: String(error.code ?? "WF_PARENT_TOOL_DENIED") } };
        }
        return next();
    }));
    disposers.push(ctx.on("tools/result", (exec, result) => {
        const raw = result.error;
        const codeFromMessage = typeof raw?.message === "string" ? /^(WF_[A-Z0-9_]+):/.exec(raw.message)?.[1] : undefined;
        const error = result.isError === true ? { message: raw?.message ?? "工具调用失败", code: raw?.info?.code ?? raw?.code ?? codeFromMessage ?? "WF_TOOL_SCHEMA_OR_EXECUTION_FAILED", retryable: false } : undefined;
        void runtime.recordParentToolResult(callerOf(exec), String(exec.name ?? ""), error).catch((cause) => runtime.warn(`Workflow 工具失败收敛：${String(cause.code ?? "unknown")}`));
    }));
    return () => { for (const dispose of disposers.reverse())
        dispose(); };
}
//# sourceMappingURL=parent-tool-boundary.js.map