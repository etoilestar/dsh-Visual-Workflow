import type { SourceNodeIR } from "../ir/source-ir.js";
export interface NormalizeContext {
    platform: string;
}
export interface SourceNodeAdapter {
    supports(node: unknown): boolean;
    normalize(node: unknown, context: NormalizeContext): SourceNodeIR;
}
export declare class SourceAdapterRegistry {
    private readonly adapters;
    constructor(adapters: readonly SourceNodeAdapter[]);
    normalize(node: unknown, context: NormalizeContext): SourceNodeIR;
}
