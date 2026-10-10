// src/host/orchestrator/errors.ts
//
// 编排运行时的错误内核（无业务依赖，供本模块与工具层共用）：
//   - WfError：稳定 code 的编排错误（工具层转 isError 工具结果 / 测试断言共用）；
//   - messageOf：任意抛出值的可读错误消息提取。
/** 编排器错误：稳定 code（工具层转 isError 工具结果/测试断言共用）。 */
export class WfError extends Error {
    code;
    constructor(message, code, extras) {
        super(message);
        this.name = 'WfError';
        this.code = code;
        if (extras)
            Object.assign(this, extras);
    }
}
/** 错误消息提取（Error 或任意值）。 */
export function messageOf(error) {
    if (error instanceof Error)
        return error.message;
    if (error && typeof error === "object") {
        const record = error;
        if (typeof record.message === "string")
            return record.message;
        if (typeof record.error === "string")
            return record.error;
        if (record.error && record.error !== error && typeof record.error === "object") {
            const nested = record.error;
            if (typeof nested.message === "string")
                return nested.message;
        }
        return typeof record.code === "string" ? `错误代码：${record.code}` : "未知结构化异常（缺少 message/code）";
    }
    return String(error ?? "");
}
//# sourceMappingURL=errors.js.map