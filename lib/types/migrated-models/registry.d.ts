import type { Context } from "@deepseek-ai/cordis";
import { type MigratedEmbeddingRequest, type MigratedEmbeddingResult, type MigratedModelType, type MigratedRerankRequest, type MigratedRerankResult, type MigratedSpeechToTextRequest, type MigratedSpeechToTextResult, type MigratedTextToSpeechRequest, type MigratedTextToSpeechResult } from "./types.js";
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
        supportedModelTypes: string[];
        configuredModelTypes: MigratedModelType[];
    }>;
    hasConfigured(type: MigratedModelType, provider?: string): boolean;
    embed(request: MigratedEmbeddingRequest): Promise<MigratedEmbeddingResult>;
    rerank(request: MigratedRerankRequest): Promise<MigratedRerankResult>;
    speechToText(request: MigratedSpeechToTextRequest): Promise<MigratedSpeechToTextResult>;
    textToSpeech(request: MigratedTextToSpeechRequest): Promise<MigratedTextToSpeechResult>;
    private activeProviders;
    private configuredCandidates;
    private resolveTarget;
}
