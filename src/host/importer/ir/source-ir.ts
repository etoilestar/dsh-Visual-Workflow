export type SourceSemanticKind =
  | "start" | "end" | "llm" | "agent" | "tool" | "knowledge"
  | "condition" | "http" | "template" | "code" | "loop" | "iteration" | "unknown"

export interface VariableReference {
  sourceNodeId: string
  sourcePort: string
}

export interface SourcePortIR {
  name: string
  required?: boolean
  dataType?: string
  references?: VariableReference[]
}

export interface SourceVariableIR {
  name: string
  scope: "workflow" | "environment" | "conversation" | "input"
  required: boolean
  dataType?: string
  sourceNodeId?: string
}

export type SourceDependencyKind = "model" | "tool" | "knowledge" | "http" | "credential"

export interface SourceDependencyIR {
  id: string
  kind: SourceDependencyKind
  source: { platform: string; provider?: string; name?: string }
  requiresCredential?: boolean
}

export interface SourceNodeIR {
  id: string
  semanticKind: SourceSemanticKind
  title?: string
  config: Record<string, unknown>
  inputs: SourcePortIR[]
  outputs: SourcePortIR[]
  source: { platform: string; type: string; raw: unknown }
}

export interface SourceEdgeIR {
  id: string
  sourceNodeId: string
  targetNodeId: string
  sourceHandle?: string
  targetHandle?: string
}

export interface SourceWorkflowIR {
  source: { platform: "dify" | string; dslVersion?: string }
  name: string
  description?: string
  nodes: SourceNodeIR[]
  edges: SourceEdgeIR[]
  variables: SourceVariableIR[]
  dependencies: SourceDependencyIR[]
}
