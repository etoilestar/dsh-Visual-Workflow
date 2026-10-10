export function recordOf(value, field) {
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        throw new TypeError(`${field} 必须为对象`);
    return value;
}
export function nameOf(name, field) {
    if (!name.trim() || name.length > 128 || ["__proto__", "constructor", "prototype"].includes(name))
        throw new TypeError(`${field} 名称无效`);
}
export function inputRequirementsOf(raw, field = "inputs") {
    const result = {};
    if (raw === undefined)
        return result;
    for (const [name, value] of Object.entries(recordOf(raw, field))) {
        nameOf(name, field);
        const part = recordOf(value, `${field}.${name}`);
        if (part.kind !== undefined && !["text", "json", "file"].includes(String(part.kind)))
            throw new TypeError(`${field}.${name}.kind 无效`);
        if (part.required !== undefined && typeof part.required !== "boolean")
            throw new TypeError(`${field}.${name}.required 必须为 boolean`);
        let source;
        if (part.source !== undefined) {
            const from = recordOf(part.source, `${field}.${name}.source`);
            if (typeof from.workflowInput === "string" && from.workflowInput.trim() && from.nodeId === undefined)
                source = { workflowInput: from.workflowInput };
            else if (typeof from.nodeId === "string" && from.nodeId.trim() && from.workflowInput === undefined && (from.output === undefined || typeof from.output === "string" && from.output.trim()))
                source = { nodeId: from.nodeId, ...(from.output === undefined ? {} : { output: from.output }) };
            else
                throw new TypeError(`${field}.${name}.source 必须指定 workflowInput 或 nodeId/output`);
        }
        result[name] = { ...(part.kind === undefined ? {} : { kind: part.kind }), ...(part.required === undefined ? {} : { required: part.required }), ...(source ? { source } : {}) };
    }
    return result;
}
export function resultSchemaOf(raw, field, depth = 0) {
    if (depth > 16)
        throw new TypeError(`${field} 结构过深`);
    const part = recordOf(raw, field);
    const keys = ["type", "properties", "required", "additionalProperties", "items", "enum", "minLength", "minItems", "minimum"];
    for (const key of Object.keys(part))
        if (!keys.includes(key))
            throw new TypeError(`${field}.${key} 不受支持`);
    if (!["object", "array", "string", "number", "integer", "boolean", "null"].includes(String(part.type)))
        throw new TypeError(`${field}.type 无效`);
    const result = { type: part.type };
    if (["properties", "required", "additionalProperties"].some((key) => part[key] !== undefined) && part.type !== "object")
        throw new TypeError(`${field} 对象规则只适用于 object`);
    if ((part.items !== undefined || part.minItems !== undefined) && part.type !== "array")
        throw new TypeError(`${field} 数组规则只适用于 array`);
    if (part.minLength !== undefined && part.type !== "string")
        throw new TypeError(`${field}.minLength 只适用于 string`);
    if (part.minimum !== undefined && !["number", "integer"].includes(String(part.type)))
        throw new TypeError(`${field}.minimum 只适用于数值`);
    if (part.properties !== undefined) {
        result.properties = {};
        for (const [name, value] of Object.entries(recordOf(part.properties, `${field}.properties`))) {
            nameOf(name, field);
            result.properties[name] = resultSchemaOf(value, `${field}.${name}`, depth + 1);
        }
    }
    if (part.required !== undefined) {
        if (!Array.isArray(part.required) || part.required.some((item) => typeof item !== "string" || !item.trim()))
            throw new TypeError(`${field}.required 必须为名称数组`);
        result.required = part.required;
    }
    if (part.additionalProperties !== undefined) {
        if (typeof part.additionalProperties !== "boolean")
            throw new TypeError(`${field}.additionalProperties 必须为 boolean`);
        result.additionalProperties = part.additionalProperties;
    }
    if (part.items !== undefined)
        result.items = resultSchemaOf(part.items, `${field}.items`, depth + 1);
    if (part.enum !== undefined) {
        if (!Array.isArray(part.enum) || !part.enum.length || part.enum.some((value) => value !== null && !["string", "number", "boolean"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value)))
            throw new TypeError(`${field}.enum 必须为非空 JSON 标量数组`);
        result.enum = part.enum;
    }
    for (const key of ["minLength", "minItems", "minimum"])
        if (part[key] !== undefined) {
            const value = part[key];
            if (typeof value !== "number" || !Number.isFinite(value) || key !== "minimum" && (!Number.isSafeInteger(value) || value < 0))
                throw new TypeError(`${field}.${key} 数值无效`);
            result[key] = value;
        }
    return result;
}
export function outputRequirementsOf(raw) {
    const result = {};
    for (const [name, value] of Object.entries(recordOf(raw, "outputs"))) {
        nameOf(name, "outputs");
        const part = recordOf(value, `outputs.${name}`);
        if (!["text", "json", "file"].includes(String(part.kind)))
            throw new TypeError(`outputs.${name}.kind 无效`);
        if (part.required !== undefined && typeof part.required !== "boolean")
            throw new TypeError(`outputs.${name}.required 必须为 boolean`);
        if (part.kind === "file" && (typeof part.path !== "string" || !part.path.trim()))
            throw new TypeError(`outputs.${name}.path 必须明确指定`);
        result[name] = { kind: part.kind, ...(part.required === undefined ? {} : { required: part.required }), ...(part.kind === "file" ? { path: part.path } : {}), ...(part.schema === undefined ? {} : { schema: resultSchemaOf(part.schema, `outputs.${name}.schema`) }) };
    }
    return result;
}
export function runtimeDefinitionOf(raw) {
    if (raw === undefined)
        return undefined;
    const part = recordOf(raw, "runtime");
    if (part.version !== 1)
        throw new TypeError("runtime.version 必须为 1；旧工作流缺省保持 explicit");
    if (part.handoffPolicy !== undefined && !["explicit", "auto", "strict"].includes(String(part.handoffPolicy)))
        throw new TypeError("runtime.handoffPolicy 无效");
    const result = { version: 1, ...(part.handoffPolicy === undefined ? {} : { handoffPolicy: part.handoffPolicy }) };
    if (part.inputs !== undefined)
        result.inputs = inputRequirementsOf(part.inputs, "runtime.inputs");
    if (part.budget !== undefined) {
        result.budget = {};
        for (const [key, value] of Object.entries(recordOf(part.budget, "runtime.budget"))) {
            if (!["executionTimeoutMs", "parentCallLimit", "nodeExecutionLimit", "tokenLimit", "repeatedFailureLimit"].includes(key) || !Number.isSafeInteger(value) || Number(value) < 1)
                throw new TypeError(`runtime.budget.${key} 必须为支持的正整数预算`);
            result.budget[key] = value;
        }
    }
    return result;
}
//# sourceMappingURL=runtime-contract.js.map