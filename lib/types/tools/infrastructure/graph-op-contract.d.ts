/**
 * 各图操作的**最小字段契约**（逐条模式）：键为 op 名，值为该 op 的形状说明。
 * 被参数层错误消息逐条引用，保证「报错说的」与「目录里写的」永远一致。
 */
export declare const OP_FIELD_SHAPES: Record<string, string>;
/** 图结构组的全部 op 形状（一段可整体引用的文本）。 */
export declare const GRAPH_OP_FIELD_TEXT: string;
/** 标记组的 op 形状。 */
export declare const MARK_OP_FIELD_TEXT = "{ op:'mark_node', nodeId:string, status:'ok'|'fail' }\uFF08\u53EA\u6807\u8BB0**\u5F53\u524D**\u95F8\u95E8\uFF0C\u4E00\u6B21\u8865\u4E01\u53EA\u80FD 1 \u6761\uFF09";
/**
 * 角色节点（agent / parent）的 data 字段契约。
 * 为什么必须显式写清 presetId：它为空意味着该节点运行期**零工具**（连读写文件都调不到），
 * 而图检查器只以告警提示，不会阻断——这条契约是模型唯一能提前避开该坑的地方。
 */
export declare const ROLE_NODE_DATA_CONTRACT: string;
/** agent / group 共用的责任元数据写图说明。 */
export declare const RESPONSIBILITY_DATA_CONTRACT = "agent/group \u8282\u70B9\u5E94\u5728 data.responsibility \u5199\u5165 {planningId?:string,id:string,purpose:string,deliverable?:string,requirementRefs?:string[]}\uFF1B\u8FD9\u662F\u8282\u70B9\u8D23\u4EFB\u4E0E\u9700\u6C42\u6765\u6E90\uFF0C\u4E0D\u662F\u72EC\u7ACB\u8D23\u4EFB\u56FE\u3002\u4FEE\u6539\u65E2\u6709\u8D23\u4EFB\u65F6\u5148\u4ECE wf_org_catalog \u8FD4\u56DE\u7684\u8282\u70B9 responsibility.id \u552F\u4E00\u5B9A\u4F4D node.id\uFF0C\u53EA\u7528 update_node_data \u66F4\u65B0\u8BE5\u8282\u70B9\uFF0C\u5E76\u4EC5\u5728\u786E\u6709\u5FC5\u8981\u65F6 disconnect/connect \u5B83\u7684\u76F4\u63A5\u4E0A\u4E0B\u6E38\u8FDE\u7EBF\uFF1B\u4E0D\u5F97\u91CD\u5EFA\u6574\u56FE\u6216\u6539\u52A8\u65E0\u5173\u8282\u70B9\u4E0E\u8FDE\u7EBF\u3002";
/** 提交规则：一次补丁怎么组织、哪些形态会被拒绝。 */
export declare const PATCH_SUBMISSION_RULES: string;
/** 稳定错误码语义（按「该改什么」分组，模型据此选择修正方向）。 */
export declare const ERROR_CODE_SEMANTICS: string;
/** 闸门标记语义（mark_node 的适用时机与判定）。 */
export declare const GATE_MARKING_SEMANTICS: string;
/**
 * 写图契约全文（`wf_org_catalog` 的 rules.patchContract 直接引用这一段）。
 * 顺序即阅读顺序：先怎么提交，再各 op 形状，再节点 data 契约，最后错误码语义。
 */
export declare const PATCH_CONTRACT_TEXT: string;
/**
 * 工具描述里的**契约指引**（中英混排的唯一一处）。
 * 两个工具共用同一份字面量：它点名 rules 的键名，如果键名改了，两侧一起失败而不是
 * 「描述指向一个不存在的字段」这种静默漂移。
 */
export declare const PATCH_CONTRACT_POINTER: string;
