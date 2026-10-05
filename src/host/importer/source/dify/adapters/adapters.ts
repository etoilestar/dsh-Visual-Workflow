import type { SourceNodeIR, SourcePortIR, SourceSemanticKind } from "../../../ir/source-ir.js"
import type { NormalizeContext, SourceNodeAdapter } from "../../registry.js"
import { sanitizeSourceValue } from "../sanitize.js"
import { isRecord, referenceInputs } from "../variables.js"

const knownKinds: Readonly<Record<string, SourceSemanticKind>> = {
  start: "start", answer: "end", end: "end", llm: "llm", agent: "agent",
  tool: "tool", "knowledge-retrieval": "knowledge", "if-else": "condition",
  condition: "condition", "http-request": "http", http: "http",
  "template-transform": "template", code: "code", loop: "loop", iteration: "iteration",
}

function nodeParts(node: unknown): { id: string; type: string; data: Record<string, unknown> } | undefined {
  if (!isRecord(node) || typeof node.id !== "string" || !isRecord(node.data) || typeof node.data.type !== "string") return undefined
  return { id: node.id, type: node.data.type, data: node.data }
}

function startOutputs(data: Record<string, unknown>): SourcePortIR[] {
  if (!Array.isArray(data.variables)) return []
  return data.variables.flatMap((variable): SourcePortIR[] => {
    if (!isRecord(variable) || typeof variable.variable !== "string") return []
    return [{ name: variable.variable, required: variable.required === true, dataType: typeof variable.type === "string" ? variable.type : undefined }]
  })
}

class TypedAdapter implements SourceNodeAdapter {
  public constructor(private readonly sourceType: string, private readonly semanticKind: SourceSemanticKind) {}
  public supports(node: unknown): boolean { return nodeParts(node)?.type === this.sourceType }
  public normalize(node: unknown, context: NormalizeContext): SourceNodeIR {
    const parts = nodeParts(node)
    if (!parts) throw new Error("Dify node is missing id or data.type")
    const sanitized = sanitizeSourceValue(parts.data)
    const config = isRecord(sanitized.value) ? sanitized.value : {}
    if (sanitized.containedCredential) config.requiresCredentialRebinding = true
    return {
      id: parts.id,
      semanticKind: this.semanticKind,
      title: typeof parts.data.title === "string" ? parts.data.title : undefined,
      config,
      inputs: this.semanticKind === "start" ? [] : referenceInputs(config),
      outputs: this.semanticKind === "start" ? startOutputs(config) : defaultOutputs(this.semanticKind),
      source: { platform: context.platform, type: parts.type, raw: sanitizeSourceValue(node).value },
    }
  }
}

function defaultOutputs(kind: SourceSemanticKind): SourcePortIR[] {
  if (kind === "end") return []
  if (kind === "llm" || kind === "agent" || kind === "template") return [{ name: "text" }]
  if (kind === "knowledge") return [{ name: "result" }]
  return []
}

class UnknownAdapter implements SourceNodeAdapter {
  public supports(node: unknown): boolean { return nodeParts(node) !== undefined }
  public normalize(node: unknown, context: NormalizeContext): SourceNodeIR {
    const parts = nodeParts(node)
    if (!parts) throw new Error("Dify node is missing id or data.type")
    const sanitized = sanitizeSourceValue(parts.data)
    const config = isRecord(sanitized.value) ? sanitized.value : {}
    if (sanitized.containedCredential) config.requiresCredentialRebinding = true
    return { id: parts.id, semanticKind: "unknown", title: typeof parts.data.title === "string" ? parts.data.title : undefined,
      config, inputs: referenceInputs(config), outputs: [], source: { platform: context.platform, type: parts.type, raw: sanitizeSourceValue(node).value } }
  }
}

export function createDifyAdapters(): SourceNodeAdapter[] {
  return [...Object.entries(knownKinds).map(([type, kind]) => new TypedAdapter(type, kind)), new UnknownAdapter()]
}
