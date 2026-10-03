import type { SemanticIssue, SemanticRepairMode } from "./types.js";
export declare function semanticIssueFingerprint(issues: SemanticIssue[]): string;
export declare function repairModeFor(repeatCount: number): SemanticRepairMode;
