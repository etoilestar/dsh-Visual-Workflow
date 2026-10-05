import type { SourceNodeIR } from "../ir/source-ir.js"

export interface NormalizeContext {
  platform: string
}

export interface SourceNodeAdapter {
  supports(node: unknown): boolean
  normalize(node: unknown, context: NormalizeContext): SourceNodeIR
}

export class SourceAdapterRegistry {
  public constructor(private readonly adapters: readonly SourceNodeAdapter[]) {}

  public normalize(node: unknown, context: NormalizeContext): SourceNodeIR {
    const adapter = this.adapters.find((candidate) => candidate.supports(node))
    if (!adapter) throw new Error("Source adapter registry has no fallback adapter")
    return adapter.normalize(node, context)
  }
}
