import type { RuntimeInputValue, RuntimeInputs, RuntimeInputOptions, SessionInputFile } from "../../host/shared/runtime-types.js"

export type InputEditorKind = "text" | "json" | "workspace" | "attachment" | "output"
export function formInputValue(kind: InputEditorKind, value: string, files: readonly SessionInputFile[]): RuntimeInputValue {
  if (kind === "text") return { kind: "text", value }
  if (kind === "json") return { kind: "json", value: JSON.parse(value) as import("../../host/shared/runtime-types.js").JsonValue }
  if (kind === "workspace") return { kind: "file", fileRef: { source: "workspace", path: value } }
  if (kind === "output") {
    const ref = JSON.parse(value) as { nodeId?: unknown; output?: string; runId?: string; attempt?: number }
    if (typeof ref?.nodeId !== "string" || !ref.nodeId.trim()) throw new Error("nodeId")
    return { kind: "output", nodeId: ref.nodeId, output: ref.output, runId: ref.runId, attempt: ref.attempt }
  }
  const file = files.find((file) => file.attachmentId === value)
  if (!file) throw new Error("attachmentId")
  return { kind: "file", fileRef: { source: "attachment", attachmentId: file.attachmentId, name: file.name, bytes: file.bytes } }
}

export function missingWorkflowInputs(inputs: RuntimeInputs, options: RuntimeInputOptions): string[] {
  return Object.entries(options.workflowInputs).filter(([name, requirement]) => requirement.required !== false && !inputs.workflowInputs[name]?.length).map(([name]) => name)
}

export function validInputSlot(name: string): boolean {
  return !!name.trim() && name.length <= 128 && !["__proto__", "prototype", "constructor"].includes(name)
}
