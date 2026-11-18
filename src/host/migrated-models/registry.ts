import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Context } from "@deepseek-ai/cordis"
import type { MigratedModelPackageManifest, MigratedModelProviderSpec } from "./types.js"

interface LoadedProvider {
  manifest: MigratedModelPackageManifest
  provider: MigratedModelProviderSpec
}

interface LlmServiceLike {
  registerAdapter(providers: string[], adapter: LlmAdapterLike): () => void
}

interface LlmAdapterLike {
  providerInfo(provider: string): { id: string; name: string }
  providerRetryPolicy(provider: string): undefined
  imageRequestPricing(provider: string, model: string): undefined
  imageRequestTarget(provider: string, model: string, image: { width: number; height: number; bytes: number }): { width: number; height: number; maxBytes: number }
  listModels(provider: string): Promise<Array<{ provider: string; id: string; name: string; description?: string; inputModalities?: string[] }>>
  resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<{ provider: string; id: string; name: string; inputModalities?: string[] }>
  prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<{
    model: { provider: string; id: string; name: string; inputModalities?: string[] }
    stream(options: LlmGenerateOptionsLike): AsyncIterable<LlmStreamChunkLike>
  }>
  stream(options: LlmGenerateOptionsLike): AsyncIterable<LlmStreamChunkLike>
}

interface LlmGenerateOptionsLike {
  provider: string
  model: string
  messages: LlmMessageLike[]
  system?: string
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>
  temperature?: number
  maxTokens?: number
  stop?: string[]
  signal?: AbortSignal
}

interface LlmMessageLike {
  role: string
  content: readonly unknown[]
  toolCallId?: unknown
  source?: { kind?: unknown; callId?: unknown }
}

type LlmStreamChunkLike = Record<string, unknown>

interface OpenAiResponse {
  choices?: Array<{
    finish_reason?: unknown
    message?: {
      content?: unknown
      tool_calls?: unknown
    }
  }>
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    total_tokens?: unknown
  }
  error?: { message?: unknown }
}

interface OpenAiStreamResponse {
  choices?: Array<{
    finish_reason?: unknown
    delta?: {
      content?: unknown
      tool_calls?: unknown
    }
  }>
  usage?: OpenAiResponse["usage"]
  error?: { message?: unknown }
}

interface StreamingToolCall {
  index: number
  blockIndex: number
  id: string
  name: string
  arguments: string
  started: boolean
  emittedArgumentsLength: number
}

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

export class MigratedModelRegistry {
  private readonly providers = new Map<string, LoadedProvider[]>()
  private credentials: Record<string, Record<string, unknown>> = {}
  private disposers: Array<() => void> = []

  constructor(private readonly dataDirectory: string) {}

  async load(): Promise<void> {
    this.providers.clear()
    this.credentials = await readCredentials(this.dataDirectory)
    const root = join(this.dataDirectory, "migrated-models")
    const directories = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    for (const entry of directories.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue
      const manifest = await readManifest(join(root, entry.name, "dsh-model-package.json"))
      for (const provider of manifest.providers) {
        const versions = this.providers.get(provider.ref) ?? []
        if (versions.some((loaded) => loaded.manifest.version === manifest.version)) {
          throw new Error(`迁移模型版本冲突：${provider.ref}@${manifest.version}`)
        }
        versions.push({ manifest, provider })
        versions.sort((left, right) => compareVersions(right.manifest.version, left.manifest.version))
        this.providers.set(provider.ref, versions)
      }
    }
  }

  register(ctx: Context): void {
    const service = ctx.get("llm") as LlmServiceLike | null | undefined
    this.disposeRegistrations()
    if (!service || typeof service.registerAdapter !== "function") {
      if (this.providers.size > 0) throw new Error("DSH llm service unavailable while migrated models are installed")
      return
    }
    for (const loaded of this.activeProviders()) {
      const credentials = resolveCredentials(loaded.provider, this.credentials[loaded.manifest.id] ?? {})
      const missing = missingCredentials(loaded.provider, credentials)
      if (missing.length > 0) {
        ctx.logger.warn(`[visual-workflow] migrated model ${loaded.provider.ref} is not selectable until credentials are configured: ${missing.join(", ")}`)
      }
      const adapter = new XinferenceAdapter(loaded, credentials)
      this.disposers.push(service.registerAdapter([loaded.provider.ref], adapter))
    }
  }

  async reload(ctx: Context): Promise<void> {
    await this.load()
    this.register(ctx)
  }

  disposeRegistrations(): void {
    for (const dispose of this.disposers.splice(0)) dispose()
  }

  list(): Array<{ ref: string; label: string; packageId: string; version: string; origin: "dify" }> {
    return this.activeProviders().map(({ provider, manifest }) => ({
      ref: provider.ref,
      label: provider.label,
      packageId: manifest.id,
      version: manifest.version,
      origin: "dify",
    }))
  }

  private activeProviders(): LoadedProvider[] {
    return [...this.providers.values()].flatMap((versions) => versions[0] ? [versions[0]] : [])
  }
}

class XinferenceAdapter implements LlmAdapterLike {
  constructor(
    private readonly loaded: LoadedProvider,
    private readonly credentials: Record<string, unknown>,
  ) {}

  providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: this.loaded.provider.label }
  }

  providerRetryPolicy(_provider: string): undefined {
    return undefined
  }

  imageRequestPricing(_provider: string, _model: string): undefined {
    return undefined
  }

  imageRequestTarget(_provider: string, _model: string, image: { width: number; height: number; bytes: number }): { width: number; height: number; maxBytes: number } {
    return { width: image.width, height: image.height, maxBytes: image.bytes }
  }

  async listModels(provider: string): Promise<Array<{ provider: string; id: string; name: string; description: string; inputModalities: string[] }>> {
    if (missingCredentials(this.loaded.provider, this.credentials).length > 0) return []
    const model = credentialText(this.credentials.model_uid)
    if (!model) return []
    return [{ provider, id: model, name: model, description: this.loaded.provider.description, inputModalities: ["text"] }]
  }

  async resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<{ provider: string; id: string; name: string; inputModalities: string[] }> {
    const configured = requiredCredential(this.credentials, "model_uid", this.loaded.provider.ref)
    if (model !== configured) throw new Error(`Xinference 模型未配置：${model}`)
    return { provider, id: model, name: model, inputModalities: ["text"] }
  }

  async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<{
    model: { provider: string; id: string; name: string; inputModalities: string[] }
    stream(options: LlmGenerateOptionsLike): AsyncIterable<LlmStreamChunkLike>
  }> {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: (options) => this.stream(options),
    }
  }

  async *stream(options: LlmGenerateOptionsLike): AsyncIterable<LlmStreamChunkLike> {
    yield* streamXinference(this.loaded, this.credentials, options)
  }
}

async function* streamXinference(
  loaded: LoadedProvider,
  credentials: Record<string, unknown>,
  options: LlmGenerateOptionsLike,
): AsyncIterable<LlmStreamChunkLike> {
  const serverUrl = requiredCredential(credentials, "server_url", loaded.provider.ref)
  const modelUid = requiredCredential(credentials, "model_uid", loaded.provider.ref)
  if (options.model !== modelUid) throw new Error(`Xinference 模型未配置：${options.model}`)
  const controller = new AbortController()
  const onAbort = (): void => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) controller.abort(options.signal.reason)
  else options.signal?.addEventListener("abort", onAbort, { once: true })
  const configuredTimeout = positiveNumber(credentials.invoke_timeout)
  const timeoutMs = configuredTimeout === undefined ? loaded.manifest.runtime.timeoutMs : configuredTimeout * 1000
  const timeout = setTimeout(() => controller.abort(new Error("Xinference request timeout")), timeoutMs)
  try {
    const response = await fetch(chatCompletionsUrl(serverUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(credentialText(credentials.api_key) ? { Authorization: `Bearer ${credentialText(credentials.api_key)}` } : {}),
      },
      body: JSON.stringify({
        model: modelUid,
        messages: openAiMessages(options),
        stream: true,
        ...(options.tools && options.tools.length > 0 ? { tools: options.tools.map((tool) => ({ type: "function", function: tool })) } : {}),
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
        ...(options.stop === undefined ? {} : { stop: options.stop }),
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const text = await readResponseText(response)
      const parsed = parseJson(text) as OpenAiResponse | undefined
      throw new Error(`Xinference 请求失败（HTTP ${response.status}）：${String(parsed?.error?.message ?? text).slice(0, 2000)}`)
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
    if (!contentType.includes("text/event-stream")) {
      const text = await readResponseText(response)
      const parsed = parseJson(text) as OpenAiResponse | undefined
      if (!parsed) throw new Error(`Xinference 返回无效 JSON（HTTP ${response.status}）`)
      yield* translateCompleteResponse(parsed)
      return
    }
    yield* translateEventStream(response)
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener("abort", onAbort)
  }
}

async function* translateCompleteResponse(response: OpenAiResponse): AsyncIterable<LlmStreamChunkLike> {
  const choice = response.choices?.[0]
  if (!choice?.message) throw new Error("Xinference 返回缺少 choices[0].message")
  const content = typeof choice.message.content === "string" ? choice.message.content : ""
  let index = 0
  if (content) {
    yield { type: "block-start", index, blockType: "text" }
    yield { type: "text-delta", index, text: content }
    yield { type: "block-end", index, block: { type: "text", text: content } }
    index += 1
  }
  const toolCalls = parseToolCalls(choice.message.tool_calls)
  for (const call of toolCalls) {
    yield { type: "block-start", index, blockType: "tool-call" }
    yield { type: "tool-call-delta", index, id: call.id, name: call.name, argumentsDelta: call.arguments }
    yield { type: "block-end", index, block: { type: "tool-call", id: call.id, name: call.name, arguments: call.arguments } }
    index += 1
  }
  const usage = parseUsage(response.usage)
  if (usage) yield { type: "usage", usage }
  yield { type: "finish", reason: finishReason(choice.finish_reason, toolCalls.length > 0) }
}

async function* translateEventStream(response: Response): AsyncIterable<LlmStreamChunkLike> {
  if (!response.body) throw new Error("Xinference 流式响应缺少响应体")
  let nextBlockIndex = 0
  let textBlockIndex: number | undefined
  let text = ""
  let finish: unknown
  let usage: ReturnType<typeof parseUsage>
  let sawDone = false
  const toolCalls = new Map<number, StreamingToolCall>()
  for await (const data of readServerSentEvents(response.body)) {
    if (data === "[DONE]") {
      sawDone = true
      break
    }
    const event = parseJson(data) as OpenAiStreamResponse | undefined
    if (!event) throw new Error("Xinference 返回无效 SSE JSON")
    if (event.error?.message !== undefined) throw new Error(`Xinference 流式请求失败：${String(event.error.message)}`)
    usage = parseUsage(event.usage) ?? usage
    const choice = event.choices?.[0]
    if (!choice) continue
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) finish = choice.finish_reason
    const delta = choice.delta
    if (!delta) continue
    if (typeof delta.content === "string" && delta.content.length > 0) {
      if (textBlockIndex === undefined) {
        textBlockIndex = nextBlockIndex++
        yield { type: "block-start", index: textBlockIndex, blockType: "text" }
      }
      text += delta.content
      yield { type: "text-delta", index: textBlockIndex, text: delta.content }
    }
    for (const fragment of parseStreamingToolCalls(delta.tool_calls)) {
      let call = toolCalls.get(fragment.index)
      if (!call) {
        call = {
          index: fragment.index,
          blockIndex: nextBlockIndex++,
          id: "",
          name: "",
          arguments: "",
          started: false,
          emittedArgumentsLength: 0,
        }
        toolCalls.set(fragment.index, call)
      }
      if (fragment.id) call.id = fragment.id
      if (fragment.name) call.name = fragment.name
      call.arguments += fragment.arguments
      if (!call.started && call.id && call.name) {
        call.started = true
        yield { type: "block-start", index: call.blockIndex, blockType: "tool-call" }
      }
      if (call.started && (fragment.arguments || fragment.id || fragment.name)) {
        const argumentsDelta = call.arguments.slice(call.emittedArgumentsLength)
        call.emittedArgumentsLength = call.arguments.length
        yield {
          type: "tool-call-delta",
          index: call.blockIndex,
          id: call.id,
          ...(call.name ? { name: call.name } : {}),
          argumentsDelta,
        }
      }
    }
  }
  if (!sawDone && finish === undefined) throw new Error("Xinference 流式响应意外中断")
  if (textBlockIndex !== undefined) {
    yield { type: "block-end", index: textBlockIndex, block: { type: "text", text } }
  }
  for (const call of [...toolCalls.values()].sort((left, right) => left.blockIndex - right.blockIndex)) {
    if (!call.name) throw new Error(`Xinference 工具调用 ${call.index} 缺少函数名`)
    call.id ||= `call_${call.index}`
    if (!call.started) {
      yield { type: "block-start", index: call.blockIndex, blockType: "tool-call" }
      yield { type: "tool-call-delta", index: call.blockIndex, id: call.id, name: call.name, argumentsDelta: call.arguments }
    } else if (call.emittedArgumentsLength < call.arguments.length) {
      yield {
        type: "tool-call-delta",
        index: call.blockIndex,
        id: call.id,
        name: call.name,
        argumentsDelta: call.arguments.slice(call.emittedArgumentsLength),
      }
    }
    yield {
      type: "block-end",
      index: call.blockIndex,
      block: { type: "tool-call", id: call.id, name: call.name, arguments: call.arguments },
    }
  }
  if (usage) yield { type: "usage", usage }
  yield { type: "finish", reason: finishReason(finish, toolCalls.size > 0) }
}

function openAiMessages(options: LlmGenerateOptionsLike): Array<Record<string, unknown>> {
  const messages = options.messages.map((message) => {
    const toolResult = message.content.find((block) => isRecord(block) && block.type === "tool-result")
    if (message.source?.kind === "tool" || toolResult) {
      const result = isRecord(toolResult) && Array.isArray(toolResult.content) ? messageText(toolResult.content) : messageText(message.content)
      const callId = isRecord(toolResult) ? toolResult.toolCallId : undefined
      return {
        role: "tool",
        content: result,
        tool_call_id: String(callId ?? message.toolCallId ?? message.source?.callId ?? ""),
      }
    }
    const role = message.role === "developer" ? "system" : message.role
    const content = messageText(message.content)
    if (role === "assistant") {
      const toolCalls = messageToolCalls(message.content)
      return {
        role,
        content: content || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      }
    }
    return { role, content }
  })
  return options.system ? [{ role: "system", content: options.system }, ...messages] : messages
}

function messageText(content: readonly unknown[]): string {
  return content.flatMap((block) => isRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : []).join("")
}

function messageToolCalls(content: readonly unknown[]): Array<Record<string, unknown>> {
  return content.flatMap((block) => {
    if (!isRecord(block) || block.type !== "tool-call" || typeof block.name !== "string") return []
    return [{
      id: String(block.id ?? block.name),
      type: "function",
      function: { name: block.name, arguments: String(block.arguments ?? "{}") },
    }]
  })
}

function parseToolCalls(value: unknown): Array<{ id: string; name: string; arguments: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!isRecord(item) || !isRecord(item.function) || typeof item.function.name !== "string") return []
    return [{
      id: typeof item.id === "string" && item.id ? item.id : `call_${index}`,
      name: item.function.name,
      arguments: typeof item.function.arguments === "string" ? item.function.arguments : "{}",
    }]
  })
}

function parseStreamingToolCalls(value: unknown): Array<{ index: number; id: string; name: string; arguments: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, fallbackIndex) => {
    if (!isRecord(item)) return []
    const fn = isRecord(item.function) ? item.function : {}
    const wireIndex = nonNegativeInteger(item.index) ?? fallbackIndex
    return [{
      index: wireIndex,
      id: typeof item.id === "string" ? item.id : "",
      name: typeof fn.name === "string" ? fn.name : "",
      arguments: typeof fn.arguments === "string" ? fn.arguments : "",
    }]
  })
}

function parseUsage(value: OpenAiResponse["usage"]): { inputTokens: number; outputTokens: number; totalTokens?: number } | undefined {
  const inputTokens = nonNegativeInteger(value?.prompt_tokens)
  const outputTokens = nonNegativeInteger(value?.completion_tokens)
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  const totalTokens = nonNegativeInteger(value?.total_tokens)
  return { inputTokens, outputTokens, ...(totalTokens === undefined ? {} : { totalTokens }) }
}

function finishReason(value: unknown, hasToolCalls: boolean): Record<string, unknown> {
  if (value === "length") return { kind: "max-tokens" }
  if (hasToolCalls || value === "tool_calls" || value === "function_call") return { kind: "tool-calls" }
  return { kind: "stop" }
}

async function readResponseText(response: Response): Promise<string> {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let byteLength = 0
  let text = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    byteLength += chunk.value.byteLength
    if (byteLength > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error("Xinference response exceeds size limit")
    }
    text += decoder.decode(chunk.value, { stream: true })
  }
  return text + decoder.decode()
}

async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let byteLength = 0
  let buffer = ""
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      byteLength += chunk.value.byteLength
      if (byteLength > MAX_RESPONSE_BYTES) throw new Error("Xinference response exceeds size limit")
      buffer += decoder.decode(chunk.value, { stream: true })
      buffer = buffer.replaceAll("\r\n", "\n")
      let boundary = buffer.indexOf("\n\n")
      while (boundary >= 0) {
        const event = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = event.split("\n")
          .filter((line) => line === "data" || line.startsWith("data:"))
          .map((line) => line.startsWith("data:") ? line.slice(5).trimStart() : "")
          .join("\n")
        if (data) yield data
        boundary = buffer.indexOf("\n\n")
      }
    }
    buffer += decoder.decode()
    const data = buffer.split("\n")
      .filter((line) => line === "data" || line.startsWith("data:"))
      .map((line) => line.startsWith("data:") ? line.slice(5).trimStart() : "")
      .join("\n")
    if (data) yield data
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function parseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function chatCompletionsUrl(serverUrl: string): string {
  const url = new URL(serverUrl)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Xinference server_url 仅支持 http/https")
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/chat/completions`
  url.search = ""
  url.hash = ""
  return url.toString()
}

function resolveCredentials(provider: MigratedModelProviderSpec, configured: Record<string, unknown>): Record<string, unknown> {
  const resolved = { ...configured }
  for (const credential of provider.credentials) {
    if (resolved[credential.name] === undefined && credential.defaultValue !== undefined) resolved[credential.name] = credential.defaultValue
  }
  return resolved
}

function missingCredentials(provider: MigratedModelProviderSpec, credentials: Record<string, unknown>): string[] {
  return provider.credentials
    .filter((credential) => credential.required && !credentialText(credentials[credential.name]))
    .map((credential) => credential.name)
}

function requiredCredential(credentials: Record<string, unknown>, name: string, provider: string): string {
  const value = credentialText(credentials[name])
  if (!value) throw new Error(`迁移模型 ${provider} 缺少凭据：${name}`)
  return value
}

function credentialText(value: unknown): string {
  return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value).trim()
}

function positiveNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

function compareVersions(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" })
}

async function readManifest(path: string): Promise<MigratedModelPackageManifest> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"))
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.id !== "string" || typeof value.version !== "string"
    || !isRecord(value.origin) || value.origin.platform !== "dify" || !isRecord(value.runtime)
    || value.runtime.kind !== "openai-compatible-model-adapter" || !Array.isArray(value.providers)) {
    throw new Error(`无效的 DSH 迁移模型包：${path}`)
  }
  const manifest = value as unknown as MigratedModelPackageManifest
  if (manifest.providers.some((provider) => !provider.ref.startsWith("dsh_model__")
    || provider.adapter !== "xinference-openai-compatible" || !Array.isArray(provider.credentials))) {
    throw new Error(`无效的 DSH 迁移模型声明：${path}`)
  }
  return manifest
}

async function readCredentials(dataDirectory: string): Promise<Record<string, Record<string, unknown>>> {
  const path = join(dataDirectory, "migrated-model-credentials.json")
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"))
    if (!isRecord(value)) throw new Error("credential root must be an object")
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw new Error(`迁移模型凭据文件无效：${path}`, { cause: error })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
