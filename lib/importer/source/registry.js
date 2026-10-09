export class SourceAdapterRegistry {
    adapters;
    constructor(adapters) {
        this.adapters = adapters;
    }
    normalize(node, context) {
        const adapter = this.adapters.find((candidate) => candidate.supports(node));
        if (!adapter)
            throw new Error("Source adapter registry has no fallback adapter");
        return adapter.normalize(node, context);
    }
}
//# sourceMappingURL=registry.js.map