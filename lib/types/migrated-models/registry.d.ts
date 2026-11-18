import type { Context } from "@deepseek-ai/cordis";
export declare class MigratedModelRegistry {
    private readonly dataDirectory;
    private readonly providers;
    private credentials;
    private disposers;
    constructor(dataDirectory: string);
    load(): Promise<void>;
    register(ctx: Context): void;
    reload(ctx: Context): Promise<void>;
    disposeRegistrations(): void;
    list(): Array<{
        ref: string;
        label: string;
        packageId: string;
        version: string;
        origin: "dify";
    }>;
    private activeProviders;
}
