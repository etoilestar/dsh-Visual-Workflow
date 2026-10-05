import { isRecord } from "./variables.js"

const secretValueFields = new Set(["authorization", "api_key", "apikey", "access_token", "refresh_token", "password", "secret", "cookie"])
const credentialReferenceFields = new Set(["credential_id", "credential_name"])

export interface SanitizedValue {
  value: unknown
  containedSecret: boolean
  requiresCredentialRebinding: boolean
}

export function sanitizeSourceValue(input: unknown): SanitizedValue {
  let containedSecret = false
  let requiresCredentialRebinding = false
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (!isRecord(value)) return value
    const output: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replaceAll("-", "_")
      if (secretValueFields.has(normalizedKey)) {
        containedSecret = true
        requiresCredentialRebinding = true
        continue
      }
      if (credentialReferenceFields.has(normalizedKey)) {
        requiresCredentialRebinding = true
        continue
      }
      output[key] = visit(nested)
    }
    return output
  }
  return { value: visit(input), containedSecret, requiresCredentialRebinding }
}
