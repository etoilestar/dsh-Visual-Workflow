import { AsyncLocalStorage } from "node:async_hooks";
import { CHILD_AGENT_HIDDEN_TOOLS, RESERVED_TRANSPORT_TOOL, TEAM_TOOL_NAMES } from "../shared/protocol.js";
export class ChildToolPermissionError extends Error {
    code = "WF_CHILD_TOOL_POLICY_FAILED";
    phase = "tool_policy";
    retryable = false;
}
function toolsOf(raw) {
    const context = raw;
    const tools = context?.get?.("tools");
    if (!tools || typeof tools.get !== "function" || typeof tools.restrict !== "function" || typeof tools.guard !== "function") {
        throw new ChildToolPermissionError("子代理缺少工具权限接口（get/restrict/guard）；无法安全启动");
    }
    return tools;
}
/** 在实际创建作用域中验证继承权限；自己的工具由执行守卫约束。 */
export function installChildToolPolicy(raw, allow, scope) {
    const tools = toolsOf(raw);
    const approved = allow === undefined ? undefined : new Set(allow);
    const hidden = CHILD_AGENT_HIDDEN_TOOLS;
    const infrastructure = [RESERVED_TRANSPORT_TOOL, ...TEAM_TOOL_NAMES];
    // 守卫先于任何权限探测安装；验证失败时仍拒绝未授权调用，创建监听器向官方传播错误。
    const disposeGuard = tools.guard(({ name }) => {
        if (typeof name !== 'string')
            return 'WF_CHILD_TOOL_DENIED: 无法识别工具执行名称';
        if (hidden.includes(name))
            return "WF_NOT_ROOT: 父代理专属工具禁止子代理调用";
        if (approved !== undefined && !approved.has(name) && !infrastructure.includes(name)) {
            return "WF_CHILD_TOOL_DENIED: 工具未获该节点授权";
        }
        return undefined;
    });
    if (approved === undefined)
        return disposeGuard;
    const inherited = [];
    for (const name of approved) {
        if (hidden.includes(name) || infrastructure.includes(name))
            continue;
        // preset 的 subagent 可能只注册在根 Agent 上；它不是子 scope 的继承能力。
        if (!tools.get(name, scope)) {
            if (name === "subagent")
                continue;
            throw new ChildToolPermissionError(`节点工具在实际子代理作用域不可用：${name}`);
        }
        try {
            // restrict 是公开的权限裁决接口；在首轮推理前探测并立即撤销，不读取私有 registry。
            tools.restrict({ deny: [name] })();
            inherited.push(name);
        }
        catch (error) {
            // 实际可见且不属于继承面的名称是 scope 自身注册工具，只由上面的守卫约束。
            if (!(error instanceof Error) || !error.message.startsWith("tools.restrict() names unknown global tool")) {
                throw new ChildToolPermissionError(`工具权限预检查失败：${name}`);
            }
        }
    }
    let disposeRestriction;
    try {
        disposeRestriction = tools.restrict({ allow: inherited });
    }
    catch {
        throw new ChildToolPermissionError("子代理工具白名单安装失败；已阻止未授权工具调用");
    }
    return () => { disposeRestriction(); disposeGuard(); };
}
export function createChildToolFilterSetup() {
    const pending = new AsyncLocalStorage();
    const remembered = new Map();
    return {
        contribution: (context, scope) => installChildToolPolicy(context, pending.getStore(), scope),
        withPending: (allow, operation) => pending.run(allow, operation),
        peekPending: () => pending.getStore(),
        remember: (id, allow) => {
            if (allow === undefined)
                remembered.delete(id);
            else
                remembered.set(id, [...allow]);
        },
        restore: (id, context, scope) => remembered.has(id)
            ? installChildToolPolicy(context, remembered.get(id), scope)
            : () => { },
    };
}
//# sourceMappingURL=child-tool-filter.js.map