import type { SourceNodeIR, SourcePortIR, SourceSemanticKind } from "../../../ir/source-ir.js"
import type { NormalizeContext } from "../../registry.js"
import { sanitizeSourceValue } from "../sanitize.js"
import { isRecord, referenceInputs } from "../variables.js"

export interface DifyNodeParts { id: string; type: string; data: Record<string, unknown>; raw: unknown }

export function readDifyNode(node: unknown): DifyNodeParts | undefined {
  if (!isRecord(node) || typeof node.id !== "string" || !isRecord(node.data) || typeof node.data.type !== "string") return undefined
  return { id: node.id, type: node.data.type, data: node.data, raw: node }
}

export function supportsType(node: unknown, types: readonly string[]): boolean {
  const type = readDifyNode(node)?.type
  return type !== undefined && types.includes(type)
}

export function normalizeNode(node: unknown, context: NormalizeContext, semanticKind: SourceSemanticKind, ports?: { inputs?: SourcePortIR[]; outputs?: SourcePortIR[] }): SourceNodeIR {
  const parts = readDifyNode(node)
  if (!parts) throw new Error("Dify node is missing id or data.type")
  const sanitized = sanitizeSourceValue(parts.data)
  const config = isRecord(sanitized.value) ? sanitized.value : {}
  if (sanitized.requiresCredentialRebinding) config.requiresCredentialRebinding = true
  return { id: parts.id, semanticKind, title: typeof parts.data.title === "string" ? parts.data.title : undefined,
    config, inputs: ports?.inputs ?? referenceInputs(config), outputs: ports?.outputs ?? [],
    source: { platform: context.platform, type: parts.type, raw: sanitizeSourceValue(parts.raw).value } }
}

export function startOutputs(node: unknown): SourcePortIR[] {
  const variables = readDifyNode(node)?.data.variables
  if (!Array.isArray(variables)) return []
  return variables.flatMap((variable): SourcePortIR[] => !isRecord(variable) || typeof variable.variable !== "string" ? [] : [{
    name: variable.variable, required: variable.required === true, dataType: typeof variable.type === "string" ? variable.type : undefined,
  }])
}
