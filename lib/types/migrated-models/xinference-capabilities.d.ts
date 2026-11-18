import type { MigratedEmbeddingRequest, MigratedEmbeddingResult, MigratedRerankRequest, MigratedRerankResult, MigratedSpeechToTextRequest, MigratedSpeechToTextResult, MigratedTextToSpeechRequest, MigratedTextToSpeechResult } from "./types.js";
export interface XinferenceConnection {
    provider: string;
    serverUrl: string;
    modelUid: string;
    apiKey?: string;
    timeoutMs: number;
}
export declare function invokeXinferenceEmbeddings(connection: XinferenceConnection, request: MigratedEmbeddingRequest): Promise<MigratedEmbeddingResult>;
export declare function invokeXinferenceRerank(connection: XinferenceConnection, request: MigratedRerankRequest): Promise<MigratedRerankResult>;
export declare function invokeXinferenceSpeechToText(connection: XinferenceConnection, request: MigratedSpeechToTextRequest): Promise<MigratedSpeechToTextResult>;
export declare function invokeXinferenceTextToSpeech(connection: XinferenceConnection, request: MigratedTextToSpeechRequest): Promise<MigratedTextToSpeechResult>;
