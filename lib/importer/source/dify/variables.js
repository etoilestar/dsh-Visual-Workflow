const referencePattern = /\{\{#([^.#{}]+)\.([^#{}]+)#\}\}/g;
export function findVariableReferences(value) {
    const references = [];
    const visit = (candidate) => {
        if (typeof candidate === "string") {
            for (const match of candidate.matchAll(referencePattern)) {
                references.push({ sourceNodeId: match[1], sourcePort: match[2] });
            }
        }
        else if (Array.isArray(candidate)) {
            candidate.forEach(visit);
        }
        else if (isRecord(candidate)) {
            Object.values(candidate).forEach(visit);
        }
    };
    visit(value);
    return references;
}
export function findSelectorReferences(config) {
    const references = [];
    const visit = (key, value) => {
        if (key.endsWith("_variable_selector") && Array.isArray(value) && value.length >= 2 && typeof value[0] === "string" && typeof value[1] === "string") {
            references.push({ sourceNodeId: value[0], sourcePort: value[1] });
            return;
        }
        if (Array.isArray(value))
            value.forEach((nested) => { if (isRecord(nested))
                Object.entries(nested).forEach(([nestedKey, child]) => visit(nestedKey, child)); });
        else if (isRecord(value))
            Object.entries(value).forEach(([nestedKey, nested]) => visit(nestedKey, nested));
    };
    Object.entries(config).forEach(([key, value]) => visit(key, value));
    return references;
}
export function referenceInputs(config) {
    const grouped = new Map();
    for (const reference of [...findVariableReferences(config), ...findSelectorReferences(config)]) {
        const key = `${reference.sourceNodeId}.${reference.sourcePort}`;
        grouped.set(key, [...(grouped.get(key) ?? []), reference]);
    }
    return [...grouped.entries()].map(([name, references]) => ({ name, references }));
}
export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=variables.js.map