import type { NodeExecutionContract } from '../shared/graph-model.js';
/** 纯形状检查；不把自然语言输入/输出说明解释成硬性 schema。 */
export declare function parseExecutionContract(raw: unknown): {
    value?: NodeExecutionContract;
    issue?: string;
};
