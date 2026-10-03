/** `/arrange` 生成过程的只读事实，仅在 Host 内存中存活。 */
export interface PlanningContext {
  readonly planningId: string
  readonly sessionId: string
  readonly originalUserIntent: string
  readonly createdAt: number
}

export interface RecordPlanningIntentInput {
  planningId: string
  sessionId: string
  originalUserIntent: string
}
