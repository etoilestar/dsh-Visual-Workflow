import type { OrchestratorRuntime } from "../../orchestrator/index.js"
import { callerOf } from "./caller.js"
import type { ToolExecLike } from "./define-tool.js"

export interface ParentToolExecution extends ToolExecLike { name?: unknown; arguments?: unknown }
export type ParentToolDecision = { kind: "allow" } | { kind: "deny"; reason: string; info?: { name: string; code: string } } | { kind: "cancel" } | { kind: "ask"; reason?: string }

/** Both native calls and PTC subcalls cross this public host pipeline. The guard cannot force-allow. */
export function registerParentToolBoundary(ctx: {
  get(name: string): unknown
  on(name: "tools/pre-execute", handler: (exec: ParentToolExecution, next: () => Promise<ParentToolDecision>) => Promise<ParentToolDecision>): () => void
  on(name: "tools/result", handler: (exec: ParentToolExecution, result: { isError?: unknown; error?: unknown }) => void): () => void
}, runtime: OrchestratorRuntime): () => void {
  const disposers: Array<() => void> = []
  const tools = ctx.get("tools") as { guard?: (guard: (exec: ParentToolExecution) => string | undefined) => () => void } | undefined
  if (typeof tools?.guard === "function") disposers.push(tools.guard((exec) => {
    const error = runtime.parentToolDenial(callerOf(exec), String(exec.name ?? ""), exec.arguments)
    return error ? `${error.code}: ${error.message}` : undefined
  }))
  else runtime.warn("宿主无公开 tools.guard；使用 tools/pre-execute 拒绝纯编排业务调用")
  disposers.push(ctx.on("tools/pre-execute", async (exec, next) => {
    try { await runtime.authorizeParentTool(callerOf(exec), String(exec.name ?? ""), exec.arguments) } catch (cause) {
      const error = cause as { code?: unknown; message?: unknown }
      return { kind: "deny", reason: String(error.message ?? "Workflow 工具调用已拒绝"), info: { name: "WorkflowPolicyError", code: String(error.code ?? "WF_PARENT_TOOL_DENIED") } }
    }
    return next()
  }))
  disposers.push(ctx.on("tools/result", (exec, result) => {
    const raw = result.error as { message?: unknown; info?: { code?: unknown; violations?: unknown }; code?: unknown } | undefined
    const codeFromMessage = typeof raw?.message === "string" ? /^(WF_[A-Z0-9_]+):/.exec(raw.message)?.[1] : undefined
    const error = result.isError === true ? { message: raw?.message ?? "工具调用失败", code: raw?.info?.code ?? raw?.code ?? codeFromMessage ?? "WF_TOOL_SCHEMA_OR_EXECUTION_FAILED", retryable: false } : undefined
    void runtime.recordParentToolResult(callerOf(exec), String(exec.name ?? ""), error).catch((cause) => runtime.warn(`Workflow 工具失败收敛：${String((cause as { code?: unknown }).code ?? "unknown")}`))
  }))
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
