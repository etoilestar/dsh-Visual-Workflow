import type { SourcePortIR, VariableReference } from "../../ir/source-ir.js"

const referencePattern = /\{\{#([^.#{}]+)\.([^#{}]+)#\}\}/g

export function findVariableReferences(value: unknown): VariableReference[] {
  const references: VariableReference[] = []
  const visit = (candidate: unknown): void => {
    if (typeof candidate === "string") {
      for (const match of candidate.matchAll(referencePattern)) {
        references.push({ sourceNodeId: match[1], sourcePort: match[2] })
      }
    } else if (Array.isArray(candidate)) {
      candidate.forEach(visit)
    } else if (isRecord(candidate)) {
      Object.values(candidate).forEach(visit)
    }
  }
  visit(value)
  return references
}

export function findSelectorReferences(config: Record<string, unknown>): VariableReference[] {
  const references: VariableReference[] = []
  const visit = (key: string, value: unknown): void => {
    if (key.endsWith("_variable_selector") && Array.isArray(value) && value.length >= 2 && typeof value[0] === "string" && typeof value[1] === "string") {
      references.push({ sourceNodeId: value[0], sourcePort: value[1] })
      return
    }
    if (Array.isArray(value)) value.forEach((nested) => { if (isRecord(nested)) Object.entries(nested).forEach(([nestedKey, child]) => visit(nestedKey, child)) })
    else if (isRecord(value)) Object.entries(value).forEach(([nestedKey, nested]) => visit(nestedKey, nested))
  }
  Object.entries(config).forEach(([key, value]) => visit(key, value))
  return references
}

export function referenceInputs(config: Record<string, unknown>): SourcePortIR[] {
  const grouped = new Map<string, VariableReference[]>()
  for (const reference of [...findVariableReferences(config), ...findSelectorReferences(config)]) {
    const key = `${reference.sourceNodeId}.${reference.sourcePort}`
    grouped.set(key, [...(grouped.get(key) ?? []), reference])
  }
  return [...grouped.entries()].map(([name, references]) => ({ name, references }))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
