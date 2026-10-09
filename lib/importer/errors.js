export class WorkflowImportError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "WorkflowImportError";
    }
}
//# sourceMappingURL=errors.js.map