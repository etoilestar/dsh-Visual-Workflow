import type { NodeExecutionContract } from '../shared/graph-model.js'

/** 纯形状检查；不把自然语言输入/输出说明解释成硬性 schema。 */
export function parseExecutionContract(raw: unknown): { value?: NodeExecutionContract; issue?: string } {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) return { issue: 'execution 必须是对象' }
  const data = raw as Record<string, unknown>
  const value: NodeExecutionContract = {}
  if (data.inputSource !== undefined) {
    if (data.inputSource !== 'ctx' && data.inputSource !== 'workspace' && data.inputSource !== 'runtime') return { issue: 'inputSource 必须为 ctx/workspace/runtime' }
    value.inputSource = data.inputSource
  }
  for (const key of ['requiredFiles', 'requiredTools', 'outputFiles'] as const) {
    if (data[key] === undefined) continue
    if (!Array.isArray(data[key]) || data[key].some((item) => typeof item !== 'string' || !item.trim())) return { issue: `${key} 必须为非空字符串数组` }
    value[key] = [...new Set((data[key] as string[]).map((item) => item.trim()))]
  }
  return { value }
}
