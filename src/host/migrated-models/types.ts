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
