import type { CheckGraphInput, GraphIssue } from "./invariants-types.js";
/** 检查规划责任的完整性、重复性，以及调用方可选提供的需求覆盖范围。 */
export declare function ruleNodeResponsibilities(input: CheckGraphInput): GraphIssue[];
