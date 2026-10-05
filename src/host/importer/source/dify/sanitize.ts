import { isRecord } from "./variables.js"

const secretKey = /(?:authorization|api[-_]?key|token|password|secret|cookie|credential)/i

export interface SanitizedValue {
  value: unknown
  containedCredential: boolean
}

export function sanitizeSourceValue(input: unknown): SanitizedValue {
  let containedCredential = false
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (!isRecord(value)) return value
    const output: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      if (secretKey.test(key)) {
        containedCredential = true
        continue
      }
      output[key] = visit(nested)
    }
    return output
  }
  return { value: visit(input), containedCredential }
}
