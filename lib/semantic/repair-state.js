export function semanticIssueFingerprint(issues) {
    return issues
        .filter((issue) => issue.level === "error")
        .map((issue) => `${issue.type}|${[...issue.requirementIds].sort().join(",")}|${[...issue.affectedNodeIds].sort().join(",")}`)
        .sort()
        .join(";");
}
export function repairModeFor(repeatCount) {
    if (repeatCount >= 3)
        return "boundary_replan";
    if (repeatCount === 2)
        return "subgraph";
    return "local";
}
//# sourceMappingURL=repair-state.js.map