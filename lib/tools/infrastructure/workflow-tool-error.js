/** DSH's public pipeline retains arbitrary plugin exceptions as message-only failures. */
export function workflowToolError(error) {
    const failure = error;
    if (error instanceof Error && typeof failure.code === "string" && failure.code.startsWith("WF_")) {
        error.message = `${failure.code}: ${error.message}${Array.isArray(failure.details) ? `; fields=${JSON.stringify(failure.details)}` : ""}`;
    }
    throw error;
}
//# sourceMappingURL=workflow-tool-error.js.map