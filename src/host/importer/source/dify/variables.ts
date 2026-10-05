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

export function referenceInputs(config: Record<string, unknown>): SourcePortIR[] {
  const grouped = new Map<string, VariableReference[]>()
  for (const reference of findVariableReferences(config)) {
    const key = `${reference.sourceNodeId}.${reference.sourcePort}`
    grouped.set(key, [...(grouped.get(key) ?? []), reference])
  }
  return [...grouped.entries()].map(([name, references]) => ({ name, references }))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
