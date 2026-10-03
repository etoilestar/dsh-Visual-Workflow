import type { WorkflowDocument } from "../shared/graph-model.js";
import type { SemanticReviewOutcome, SemanticReviewResult } from "./types.js";
export interface AgentDefaultModelLike {
    currentSelection(): {
        provider: string;
        model: string;
    } | null;
}
export interface LlmLike {
    stream(input: {
        provider: string;
        model: string;
        messages: Array<{
            role: "system" | "user";
            content: string;
        }>;
    }): AsyncIterable<unknown>;
}
export interface SemanticReviewerRuntime {
    agentDefaultModel?: AgentDefaultModelLike | null | (() => AgentDefaultModelLike | null);
    llm?: LlmLike | null | (() => LlmLike | null);
    logger?: {
        error(message: string): void;
    };
}
export interface SemanticWorkflowView {
    nodes: Array<Record<string, unknown>>;
    lines: Array<{
        source: string;
        target: string;
        channel: "flow" | "ctx" | "db";
        condition?: unknown;
    }>;
}
export declare function buildSemanticWorkflowView(flow: WorkflowDocument): SemanticWorkflowView;
export declare const SEMANTIC_REVIEWER_PROMPT = "\u4F60\u662F\u53EA\u8BFB workflow semantic reviewer\uFF1B\u4F60\u6CA1\u6709\u8BBE\u8BA1\u8BE5 workflow\uFF0C\u4E5F\u4E0D\u80FD\u8FD4\u56DE graph patch\u3002\nRequirement source authority\uFF1A\u6240\u6709 requirement \u53EA\u80FD\u6765\u81EA originalUserIntent\u3002\u521B\u5EFA requirement \u524D\u5FC5\u987B\u80FD\u6307\u51FA\u662F\u54EA\u6761\u539F\u59CB\u610F\u56FE\u8BC1\u660E\u5B83\u5B58\u5728\uFF1B\u4E0D\u80FD\u8BC1\u660E\u5C31\u4E0D\u8981\u521B\u5EFA\u3002workflow \u4EC5\u662F\u5B9E\u73B0\u8BC1\u636E\uFF0C\u4E0D\u80FD\u53CD\u63A8\u51FA\u9700\u6C42\u3002\n\u53EA\u68C0\u67E5 requirement_uncovered\u3001requirement_partially_covered\u3001responsibility_overlap\u3001dataflow_semantic_mismatch\u3002\u804C\u8D23\u8F7B\u5FAE\u4EA4\u53C9\u4E0D\u7B97 overlap\uFF0C\u53EA\u6709\u6838\u5FC3\u4E1A\u52A1\u8D23\u4EFB\u9AD8\u5EA6\u91CD\u53E0\u624D\u62A5\u544A\uFF0C\u4E14 responsibility_overlap \u5FC5\u987B\u4E3A warning\uFF1B\u5176\u4ED6\u4E09\u7C7B\u660E\u786E\u95EE\u9898\u4E3A error\u3002\ndataflow \u53EA\u628A ctx\u3001db \u6216\u660E\u786E outputSchema \u5F53\u4F5C\u771F\u5B9E\u6570\u636E\u4EA4\u63A5\uFF1B\u666E\u901A flow \u7EBF\u53EA\u4EE3\u8868\u987A\u5E8F\uFF0C\u4E0D\u80FD\u5F53\u6570\u636E\u4F20\u8F93\u3002\n\u7981\u6B62\u91CD\u65B0\u8BBE\u8BA1 workflow\uFF0C\u7981\u6B62\u4EC5\u4E3A\u6700\u4F73\u5B9E\u8DF5\u8981\u6C42 validator\u3001retry\u3001synchronizer\u3001feedback loop\u3001aggregator \u6216\u989D\u5916 robustness mechanism\uFF0C\u9664\u975E\u539F\u59CB\u9700\u6C42\u660E\u786E\u8981\u6C42\u3002\nSUFFICIENCY STOP RULE\uFF1A\u660E\u786E\u9700\u6C42\u5DF2\u8986\u76D6\u3001\u6838\u5FC3\u804C\u8D23\u65E0\u660E\u663E\u51B2\u7A81\u3001\u5FC5\u8981\u6570\u636E\u4EA4\u63A5\u6210\u7ACB\u5C31 PASS\uFF0C\u4E0D\u7EE7\u7EED\u5BFB\u627E\u53EF\u4F18\u5316\u9879\u3002\n\u53EA\u8F93\u51FA\u4E25\u683C JSON\uFF1A{\"passed\":boolean,\"requirements\":[{\"id\":string,\"text\":string,\"ownerNodeIds\":string[]}],\"issues\":[{\"type\":string,\"level\":\"error\"|\"warning\",\"requirementIds\":string[],\"affectedNodeIds\":string[],\"reason\":string,\"evidence\":string,\"repairGuidance\":string}]}\u3002passed=true \u65F6\u4E0D\u5F97\u6709 error\u3002requirement id \u5FC5\u987B\u552F\u4E00\uFF0C\u6240\u6709\u8282\u70B9 id \u5FC5\u987B\u6765\u81EA workflow\u3002";
export declare class SemanticReviewer {
    private readonly runtime;
    constructor(runtime: SemanticReviewerRuntime);
    review(originalUserIntent: string, flow: WorkflowDocument): Promise<SemanticReviewOutcome>;
    private unavailable;
}
export declare function parseSemanticReview(text: string, flow: WorkflowDocument): SemanticReviewResult;
