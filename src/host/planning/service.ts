import type { PlanningContext, RecordPlanningIntentInput } from "./types.js"

/** 持有每个会话最近一次 `/arrange` 的进程内规划上下文。 */
export class PlanningService {
  private readonly contextsBySession = new Map<string, PlanningContext>()
  private readonly planningIds = new Set<string>()

  constructor(private readonly now: () => number = Date.now) {}

  record(input: RecordPlanningIntentInput): PlanningContext {
    if (this.planningIds.has(input.planningId)) {
      throw new Error(`planningId 已存在：${input.planningId}`)
    }
    const context = Object.freeze({ ...input, createdAt: this.now() })
    this.planningIds.add(context.planningId)
    this.contextsBySession.set(context.sessionId, context)
    return context
  }

  getPlanningContext(sessionId: string): PlanningContext | undefined {
    return this.contextsBySession.get(sessionId)
  }
}
