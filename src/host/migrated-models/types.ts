export const MIGRATED_XINFERENCE_MODEL_TYPES = ["llm", "text-embedding", "rerank", "speech2text", "tts"] as const

export type MigratedModelType = typeof MIGRATED_XINFERENCE_MODEL_TYPES[number]

export interface MigratedModelCredentialSpec {
  name: string
  label: string
  type: string
  required: boolean
  secret: boolean
  defaultValue?: unknown
}

export interface MigratedModelProviderSpec {
  ref: string
  name: string
  label: string
  description: string
  adapter: "xinference-openai-compatible"
  supportedModelTypes: string[]
  credentials: MigratedModelCredentialSpec[]
}

export interface MigratedModelPackageManifest {
  schemaVersion: 1
  id: string
  name: string
  version: string
  description: string
  origin: {
    platform: "dify"
    targetVersion: string
    packageId: string
    sha256: string
    author: string
    plugin: string
  }
  runtime: {
    kind: "openai-compatible-model-adapter"
    timeoutMs: number
  }
  providers: MigratedModelProviderSpec[]
}

export interface MigratedModelTarget {
  provider?: string
  model?: string
  signal?: AbortSignal
}

export interface MigratedEmbeddingRequest extends MigratedModelTarget {
  texts: readonly string[]
  inputType?: "document" | "query"
}

export interface MigratedEmbeddingResult {
  provider: string
  model: string
  embeddings: number[][]
  usage?: { promptTokens?: number; totalTokens?: number }
}

export interface MigratedRerankRequest extends MigratedModelTarget {
  query: string
  documents: readonly string[]
  topN?: number
  scoreThreshold?: number
}

export interface MigratedRerankResult {
  provider: string
  model: string
  results: Array<{ index: number; text: string; score: number }>
}

export interface MigratedSpeechToTextRequest extends MigratedModelTarget {
  audio: Uint8Array
  fileName?: string
  contentType?: string
  language?: string
  prompt?: string
  temperature?: number
}

export interface MigratedSpeechToTextResult {
  provider: string
  model: string
  text: string
}

export type MigratedSpeechFormat = "mp3" | "wav" | "pcm" | "flac" | "aac" | "opus"

export interface MigratedTextToSpeechRequest extends MigratedModelTarget {
  input: string
  voice?: string
  responseFormat?: MigratedSpeechFormat
  speed?: number
}

export interface MigratedTextToSpeechResult {
  provider: string
  model: string
  audio: Uint8Array
  contentType: string
}
