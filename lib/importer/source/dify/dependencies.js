import { isRecord } from "./variables.js";
export function collectDifyDependencies(nodes) {
    const dependencies = [];
    for (const node of nodes) {
        if (node.semanticKind === "llm" || node.semanticKind === "agent") {
            const model = isRecord(node.config.model) ? node.config.model : undefined;
            if (model && typeof model.name === "string")
                dependencies.push(dependency(node, "model", string(model.provider), model.name));
        }
        if (node.semanticKind === "tool")
            dependencies.push(dependency(node, "tool", string(node.config.provider_id), string(node.config.tool_name)));
        if (node.semanticKind === "knowledge") {
            const ids = Array.isArray(node.config.dataset_ids) ? node.config.dataset_ids : [];
            ids.filter((id) => typeof id === "string").forEach((id) => dependencies.push(dependency(node, "knowledge", undefined, id)));
        }
        if (node.semanticKind === "http")
            dependencies.push(dependency(node, "http", undefined, string(node.config.url)));
        if (node.config.requiresCredentialRebinding === true)
            dependencies.push({
                id: `${node.id}:credential`, kind: "credential", source: { platform: "dify", name: node.title ?? node.id }, requiresCredential: true,
            });
    }
    return dependencies;
}
function dependency(node, kind, provider, name) {
    return { id: `${node.id}:${kind}:${provider ?? ""}:${name ?? ""}`, kind, source: { platform: "dify", provider, name } };
}
function string(value) { return typeof value === "string" ? value : undefined; }
//# sourceMappingURL=dependencies.js.map