/** 纯形状检查；不把自然语言输入/输出说明解释成硬性 schema。 */
export function parseExecutionContract(raw) {
    if (raw === undefined || raw === null)
        return {};
    if (typeof raw !== 'object' || Array.isArray(raw))
        return { issue: 'execution 必须是对象' };
    const data = raw;
    const value = {};
    if (data.inputSource !== undefined) {
        if (data.inputSource !== 'ctx' && data.inputSource !== 'workspace' && data.inputSource !== 'runtime')
            return { issue: 'inputSource 必须为 ctx/workspace/runtime' };
        value.inputSource = data.inputSource;
    }
    for (const key of ['requiredFiles', 'requiredTools', 'outputFiles']) {
        if (data[key] === undefined)
            continue;
        if (!Array.isArray(data[key]) || data[key].some((item) => typeof item !== 'string' || !item.trim()))
            return { issue: `${key} 必须为非空字符串数组` };
        value[key] = [...new Set(data[key].map((item) => item.trim()))];
    }
    return { value };
}
//# sourceMappingURL=execution-contract.js.map