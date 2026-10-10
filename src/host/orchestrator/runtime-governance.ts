import { resolve } from "node:path"
import { RESERVED_TRANSPORT_TOOL, WF_EXPERIENCE, WF_FINISH, WF_GRAPH_PATCH, WF_ORG_CATALOG, WF_RUN_NODE, WF_RUN_NODE_WAIT } from "../shared/protocol.js"
import { WfError, messageOf } from "./errors.js"
import type { RunEntry, RunNodeArgs, RunNodeResult } from "./run-entry.js"
import type { CallerInfo } from "./seams.js"
import { failureOf } from "./snapshot.js"
import { RuntimeLifecycle } from "./runtime-lifecycle.js"

const COORDINATOR_TOOLS: readonly string[] = ["read", "ask_user", WF_RUN_NODE, WF_RUN_NODE_WAIT, WF_FINISH, WF_GRAPH_PATCH, WF_ORG_CATALOG, WF_EXPERIENCE, RESERVED_TRANSPORT_TOOL]

export class RuntimeGovernance extends RuntimeLifecycle {
  parentToolDenial(caller: CallerInfo, name: string, args: unknown): WfError | undefined {
    const entry = caller.isChild || !caller.sessionId ? null : this.activeRunForSession(caller.sessionId)
    if (!entry || entry.executorParentId) return undefined
    const denied = (): WfError => new WfError(`纯编排父代理不能调用 ${name} 执行业务或绑定输入；请使用工作台运行输入与 Workflow 调度工具`, "WF_PARENT_TOOL_DENIED", { retryable: false })
    if (!COORDINATOR_TOOLS.includes(name)) return denied()
    const part = args && typeof args === "object" ? args as Record<string, unknown> : {}
    if (name === "read") {
      const path = part.path ?? part.file_path
      if (typeof path !== "string" || resolve(path) !== this.deps.store.orchestrationFilePath(entry.snapshot.id)) return denied()
    }
    if (name === WF_GRAPH_PATCH) {
      const operations = Array.isArray(part.operations) ? part.operations : Array.isArray(part.ops) ? part.ops : [part]
      for (const raw of operations) {
        const op = raw as { op?: unknown; type?: unknown; data?: unknown; patch?: unknown; node?: { data?: unknown } } | null
        if (op?.op === "create_node") {
          const data = op.node?.data
          if (data && typeof data === "object" && ["content", "files", "managedPath", "fileName"].some((key) => Object.hasOwn(data, key))) return denied()
        }
        if (op?.op !== "update_node_data" && op?.type !== "update_node_data") continue
        const data = op.data ?? op.patch
        if (data && typeof data === "object" && ["systemPrompt", "execution", "content", "files", "managedPath", "fileName"].some((key) => Object.hasOwn(data, key))) return denied()
      }
    }
    return undefined
  }

  async authorizeParentTool(caller: CallerInfo, name: string, args: unknown): Promise<void> {
    const entry = caller.isChild || !caller.sessionId ? null : this.activeRunForSession(caller.sessionId)
    if (!entry) return
    await this.enforceRuntimeBudget(entry)
    const usage = entry.snapshot.usage ??= { parentCalls: 0, nodeExecutions: 0, tokens: 0, tokenAccounting: "unavailable" }
    usage.parentCalls += 1
    if (entry.snapshot.budget?.parentCallLimit !== undefined && usage.parentCalls > entry.snapshot.budget.parentCallLimit) await this.failBudget(entry, "WF_PARENT_CALL_LIMIT", "父代理工具调用预算耗尽")
    const denied = this.parentToolDenial(caller, name, args)
    if (denied) throw denied
  }

  async recordParentToolResult(caller: CallerInfo, name: string, error?: unknown): Promise<void> {
    const entry = caller.isChild || !caller.sessionId ? null : this.activeRunForSession(caller.sessionId)
    if (!entry) return
    if (error === undefined) { delete entry.repeatedFailure; return }
    const failure = failureOf(error, "parent_execute", "WF_TOOL_EXECUTION_FAILED", this.now())
    entry.snapshot.parentFailures ??= []
    entry.snapshot.parentFailures.push(failure)
    if (entry.snapshot.parentFailures.length > 1000) entry.snapshot.parentFailures.shift()
    const key = `${name}:${failure.code}`
    entry.repeatedFailure = { key, count: entry.repeatedFailure?.key === key ? entry.repeatedFailure.count + 1 : 1 }
    await this.persistWarn(entry)
    if (entry.repeatedFailure.count >= (entry.snapshot.budget?.repeatedFailureLimit ?? 5)) await this.failBudget(entry, "WF_REPEATED_FAILURE", `工具 ${name} 持续失败（${failure.code}），运行已终止；请根据字段诊断修正后重启`)
  }

  async enforceRuntimeBudget(entry: RunEntry): Promise<void> {
    if (entry.controller.signal.aborted || entry.snapshot.status !== "running") throw new WfError("运行已取消", "WF_CANCELLED")
    const usage = entry.snapshot.usage ??= { parentCalls: 0, nodeExecutions: 0, tokens: 0, tokenAccounting: "unavailable" }
    entry.tokenBase ??= usage.tokens
    entry.tokenMeters ??= new Map()
    const ids = [entry.snapshot.sessionId, ...[...this.childIndex].filter(([, meta]) => meta.runId === entry.snapshot.id).map(([id]) => id)]
    for (const id of ids) {
      const meter = this.deps.agents.tokenUsageSince?.(id, Date.parse(entry.snapshot.startedAt))
      const previous = entry.tokenMeters.get(id)
      if (meter) entry.tokenMeters.set(id, { total: Math.max(previous?.total ?? 0, meter.total), complete: (previous?.complete ?? true) && meter.complete, observed: (previous?.observed ?? false) || meter.observed })
      else if (!previous) entry.tokenMeters.set(id, { total: 0, complete: false, observed: false })
    }
    const meters = [...entry.tokenMeters.values()]
    usage.tokens = entry.tokenBase + meters.reduce((sum, meter) => sum + meter.total, 0)
    const complete = meters.every((meter) => meter.complete)
    usage.tokenAccounting = complete && meters.some((meter) => meter.observed) ? "available" : "unavailable"
    const limit = entry.snapshot.budget?.tokenLimit
    if (limit !== undefined && !complete) await this.failBudget(entry, "WF_TOKEN_ACCOUNTING_UNAVAILABLE", "配置了 Token 预算，但宿主未提供完整 usage.totalTokens；无法保证预算，运行已安全终止")
    if (limit !== undefined && usage.tokens >= limit) await this.failBudget(entry, "WF_TOKEN_LIMIT", "运行达到 Token 预算")
    const timeout = entry.snapshot.budget?.executionTimeoutMs ?? this.executionTimeoutMs
    if (timeout > 0 && this.now() - Date.parse(entry.snapshot.startedAt) >= timeout) await this.failBudget(entry, "WF_EXECUTION_TIMEOUT", "运行达到配置的执行时限")
  }

  private async failBudget(entry: RunEntry, code: string, message: string): Promise<never> {
    const error = new WfError(message, code, { phase: "run_finish", retryable: false })
    try { this.deps.agents.cancelRoot?.(entry.snapshot.sessionId, code) } catch (cause) { this.warn(`父代理取消失败：${messageOf(cause)}`) }
    await this.terminateRun(entry, { status: "failed", summary: message, abortReason: code, termination: { source: "runtime", stopReason: code, failure: failureOf(error, "run_finish", code, this.now()) } })
    throw error
  }

  cancelParentForBudget(entry: RunEntry): void {
    try { this.deps.agents.cancelRoot?.(entry.snapshot.sessionId, "WF_EXECUTION_TIMEOUT") } catch (error) { this.warn(`父代理取消失败：${messageOf(error)}`) }
  }

  override async wfRunNode(caller: CallerInfo, args: RunNodeArgs, signal?: AbortSignal, options: { expectedMode?: "mode1" | "mode2" } = {}): Promise<RunNodeResult> {
    const entry = caller.isChild || !caller.sessionId ? null : this.activeRunForSession(caller.sessionId)
    if (entry) await this.enforceRuntimeBudget(entry)
    try { return await super.wfRunNode(caller, args, signal, options) } catch (error) {
      const active = entry ?? (caller.isChild || !caller.sessionId ? null : this.activeRunForSession(caller.sessionId))
      if (active && ["WF_GLOBAL_LIMIT", "WF_NODE_EXECUTION_LIMIT"].includes(String((error as { code?: unknown }).code))) await this.failBudget(active, (error as WfError).code, messageOf(error))
      throw error
    }
  }
}
