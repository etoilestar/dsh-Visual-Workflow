// src/host/prompts/reflection.ts
//
// 运行终态「复盘指令」文案构建器（纯函数）：
//   一次 Workflow Run 进入 completed / failed / stopped 三种终态时，由编排运行时向
//   父代理注入本指令，要求父代理从**本次组织执行过程**中识别未来可能具有参考价值的
//   组织经验，复盘后经 wf_experience 提交候选经验（由该工具渲染多选卡片、用户确认后入库）。
//
// 设计要点：
//   - 复述方案语义（要求做什么），不写运行日志摘要（不复制长日志、不要求汇报本次任务）；
//   - 机器事实只列三项：run 状态 / 总耗时 / 节点总数（用户裁决：token 用量与上下文
//     健康度本阶段不采集，故文案里不得出现未采集的事实）；
//   - 明确区分 Fact（机器事实）与 Inference（推理），禁止「采用 A + 任务最终成功 =
//     A 是好策略」这类事后归因；
//   - 允许 0 条：宁可不产生经验，也不产生过度泛化或语义重复的条目；
//   - 语言规则沿用共享措辞（prompt-rules）；systemLanguage 为空时按中文措辞；
//   - 纯函数：不读时钟/随机源，同一入参输出字节相同。
import { languageRuleLine } from './prompt-rules.js';
/** 复盘指令标题标记（父代理与单测据此识别消息性质；亦便于排障与用户识别）。 */
export const REFLECTION_MARKER = '【复盘】';
/** 提交经验候选的工具名（复盘中出现在指令正文里的唯一行动入口）。 */
export const REFLECTION_TOOL_NAME = 'wf_experience';
/** 提示词中声明的候选经验条数上限（与 wf_experience 的运行时校验同口径）。 */
export const REFLECTION_MAX_EXPERIENCES = 8;
/** systemLanguage 缺省时的语言名（插件默认中文界面）。 */
const DEFAULT_REFLECTION_LANGUAGE = '中文';
/** 是否按中文措辞渲染（空串沿用中文：默认中文界面口径）。 */
function isChinese(language) {
    const value = String(language ?? '').trim();
    return value === '' || value.startsWith('中');
}
/** 语言规则行（沿用共享措辞；语言名缺省时按默认语言，故恒非空）。 */
function reflectionLanguageRule(systemLanguage) {
    const language = String(systemLanguage ?? '').trim() || DEFAULT_REFLECTION_LANGUAGE;
    return languageRuleLine(language);
}
/** 终态中文文案（与编排器 statusText 同域，此处只覆盖三种注入态）。 */
const TERMINAL_STATUS_TEXT = {
    completed: '已完成',
    failed: '失败',
    stopped: '已停止',
};
/** 英文终态文案（systemLanguage 非中文时的措辞分支）。 */
const TERMINAL_STATUS_TEXT_EN = {
    completed: 'completed',
    failed: 'failed',
    stopped: 'stopped',
};
/**
 * 总耗时渲染（纯函数）：不可计算为「不可计算」；不足 1 分钟按秒（一位小数），
 * 超过 1 分钟按「X 分 Y.Y 秒」。负值与 NaN 归入不可计算。
 */
function formatDuration(durationMs, chinese) {
    const ms = typeof durationMs === 'number' && Number.isFinite(durationMs) ? Math.max(0, durationMs) : null;
    if (ms === null)
        return chinese ? '不可计算' : 'unavailable';
    if (ms < 60_000)
        return `${(ms / 1000).toFixed(1)} 秒`;
    const minutes = Math.floor(ms / 60_000);
    const seconds = ((ms % 60_000) / 1000).toFixed(1);
    return `${minutes} 分 ${seconds} 秒`;
}
/** 中文复盘指令正文（主分支）。 */
function buildChineseReflection(facts) {
    const runLabel = `${facts.flowName || facts.runId}（runId=${facts.runId}）`;
    const lines = [
        `${REFLECTION_MARKER}本次工作流运行「${runLabel}」已${TERMINAL_STATUS_TEXT[facts.status]}，现在进入复盘环节。`,
        '请从这次组织的执行过程中识别**未来可能具有参考价值的组织经验**——重点不是总结本次任务做了什么，也不必复述运行日志；',
        '要沉淀的是「下次遇到同类任务时，组织形态与调度方式上什么做法有效、什么做法无效」这类可迁移的判断。',
        '',
        '【机器事实】',
        `- run 状态：${TERMINAL_STATUS_TEXT[facts.status]}`,
        `- 总耗时：${formatDuration(facts.durationMs, true)}`,
        `- 节点总数：${facts.nodeCount}`,
        ...outcomeFacts(facts, true),
        '以上内容是本次运行已采集的机器事实；未采集的信息不得补写为事实。',
        '',
        '【复盘步骤】',
        '1. 回顾任务上下文：用户真正要什么、有哪些硬约束、交付物是什么。',
        '2. 回顾初始组织形态：父代理与各角色节点、协作组、数据/文件连线当初为什么这样切分。',
        '3. 回顾执行过程：哪些节点顺利、哪些反复、哪些产出没有被下游有效使用。',
        '4. 找出重要偏差：实际结果与预期的差距，以及造成差距的具体动作。',
        '5. 分析 Action→Outcome：每个动作实际导致了什么结果，因果关系要能解释清楚。',
        '6. 生成经验：把可迁移的规律写成一条经验，而不是写成一次事件记录。',
        '7. 检查是否过度泛化：换一个任务是否仍然成立？不成立就收窄或丢弃。',
        '8. 若这次运行没有足够价值可沉淀，允许返回 0 条经验。',
        '',
        '【事实与推理必须分开】',
        '- Fact（机器事实）：只来自上面的机器事实，以及运行记录中可核对的产出与状态；无完成节点时不得称业务节点已顺利执行。',
        '- Inference（推理）：你对因果的解释、对策略好坏的判断，必须标明为推理。',
        '- 禁止此类归因：因为「采用了方案 A」且「任务最终成功」，就断言「A 是好策略」；同理，失败也不能直接归罪于某个决定。',
        '- 只有当推理能说明因果机制（为什么有效、在什么条件下有效）时，才把它写成经验。',
        '',
        '【经验约束】',
        '- 总量控制在约 500 个中文字符以内，结构化表述，不写长段落。',
        '- 每条经验的 insight 尽量是单句结论；evidence 只保留关键事实。',
        '- 语义重复的经验必须合并成一条，不要为同一规律写多条。',
        '- 不确定、证据不足时宁可不产生；允许 0 条。',
        '',
        '【收尾动作】',
        `有 ${1}~${REFLECTION_MAX_EXPERIENCES} 条候选经验时，调用工具 ${REFLECTION_TOOL_NAME}：它将候选渲染成多选卡片，由用户确认后入库；不要跳过用户确认，用户不选择任何条目时不入库。`,
        `工具入参：experiences 为数组，每条含 task_type / task_context / insight（必填）与 evidence? / source_run_id?（可选，本次运行可填 runId=${facts.runId}）。`,
        '其中 task_type 是粗粒度任务类型（如「软件开发」「数据分析」），task_context 是可用于语义检索的自然语言上下文，不是标题。',
        `没有值得沉淀的经验时直接结束复盘，不调用 ${REFLECTION_TOOL_NAME}，不提交空数组。`,
    ];
    const rule = reflectionLanguageRule(facts.systemLanguage);
    lines.push('', rule);
    return lines.join('\n');
}
/** 英文复盘指令正文（systemLanguage 非中文时）。 */
function buildEnglishReflection(facts) {
    const runLabel = `${facts.flowName || facts.runId} (runId=${facts.runId})`;
    const lines = [
        `${REFLECTION_MARKER}The workflow run "${runLabel}" is now ${TERMINAL_STATUS_TEXT_EN[facts.status]}, so this is the reflection step.`,
        'Identify **organizational experience that may be worth reusing in the future** from how this organization executed — do not merely summarize what this task did, and do not restate the run log.',
        'What matters is transferable judgement: which organizational shapes and scheduling decisions worked, and which did not, for this kind of task.',
        '',
        '[Machine facts]',
        `- run status: ${TERMINAL_STATUS_TEXT_EN[facts.status]}`,
        `- total duration: ${formatDuration(facts.durationMs, false)}`,
        `- node count: ${facts.nodeCount}`,
        ...outcomeFacts(facts, false),
        'These are the collected machine facts; do not invent facts for uncollected information.',
        '',
        '[Reflection steps]',
        '1. Recall the task context: what the user actually needed, the hard constraints, the deliverable.',
        '2. Recall the initial organization: why the parent agent, role nodes, groups and data/file links were split that way.',
        '3. Recall the execution: which nodes went smoothly, which repeated, which outputs downstream never used.',
        '4. Find the important deviations between the actual result and the expectation, and the actions that caused them.',
        '5. Analyse Action to Outcome: what each action actually produced, with an explainable causal chain.',
        '6. Form the experience as a transferable rule, not as a record of one event.',
        '7. Check for over-generalization: would it still hold for another task? If not, narrow it or drop it.',
        '8. If this run has nothing worth keeping, returning 0 experiences is allowed.',
        '',
        '[Separate Fact from Inference]',
        '- Fact: the machine facts above plus verifiable outputs and node statuses in the run record; zero completed nodes cannot be described as successful business execution.',
        '- Inference: your causal explanations and judgements about strategy quality; label them as inference.',
        '- Forbidden attribution: "we chose approach A and the task succeeded, therefore A is a good strategy" (and symmetrically, blaming one decision for a failure).',
        '- Only write an experience when the inference explains the causal mechanism (why it worked, under which conditions).',
        '',
        '[Experience constraints]',
        '- Keep the whole submission under roughly 500 Chinese characters; use structured phrasing, not long prose.',
        '- Keep each insight a single sentence; keep evidence to the key facts only.',
        '- Merge semantically duplicated experiences into one entry.',
        '- When uncertain or under-evidenced, prefer producing nothing; 0 experiences is allowed.',
        '',
        '[Closing action]',
        `For 1 to ${REFLECTION_MAX_EXPERIENCES} candidates, call ${REFLECTION_TOOL_NAME}: it renders a multi-select card for user confirmation before storage. Store nothing when the user selects none; do not skip confirmation.`,
        `Tool arguments: experiences is an array; each entry requires task_type / task_context / insight and accepts optional evidence and source_run_id (use runId=${facts.runId} for this run).`,
        'task_type is a coarse task category (e.g. "software development"); task_context is natural-language context used for semantic retrieval, not a title.',
        `When no experience is worth keeping, finish reflection without calling ${REFLECTION_TOOL_NAME}; do not submit an empty array.`,
    ];
    const rule = reflectionLanguageRule(facts.systemLanguage);
    lines.push('', rule);
    return lines.join('\n');
}
function outcomeFacts(facts, chinese) {
    const fields = [
        [chinese ? '运行摘要' : 'run summary', facts.runSummary],
        [chinese ? '完成节点' : 'completed nodes', facts.completedNodes],
        [chinese ? '失败节点' : 'failed nodes', facts.failedNodes],
        [chinese ? '跳过节点' : 'skipped nodes', facts.skippedNodes],
        [chinese ? '错误码' : 'error codes', facts.errorCodes],
    ];
    return fields.map(([label, value]) => `- ${label}：${value === undefined ? (chinese ? '未采集' : 'not collected') : JSON.stringify(value)}`);
}
/**
 * 组装运行终态复盘指令（纯函数：同一入参输出字节相同）。
 * systemLanguage 为空串时按中文措辞（与插件默认中文界面一致）。
 */
export function buildReflectionPrompt(facts) {
    return isChinese(String(facts.systemLanguage ?? ''))
        ? buildChineseReflection(facts)
        : buildEnglishReflection(facts);
}
//# sourceMappingURL=reflection.js.map