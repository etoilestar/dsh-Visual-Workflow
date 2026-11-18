import { createServer, type Server } from "node:http"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Context } from "@deepseek-ai/cordis"
import { MigratedModelRegistry } from "../../../src/host/migrated-models/registry.js"

interface CapturedAdapter {
  listModels(provider: string): Promise<Array<{ id: string }>>
  stream(options: Record<string, unknown>): AsyncIterable<Record<string, unknown>>
}

const temporaryDirectories: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("MigratedModelRegistry", () => {
  it("test_register_xinference_provider_with_configured_model_and_translate_chat_response", async () => {
    const requests: Array<Record<string, unknown>> = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>)
        response.writeHead(200, { "Content-Type": "text/event-stream" })
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "hello " }, finish_reason: null }] })}\r\n\r\n`)
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "from xinference" }, finish_reason: "stop" }] })}\r\n\r\n`)
        response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } })}\r\n\r\n`)
        response.end("data: [DONE]\r\n\r\n")
      })
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("test server did not expose a port")

    const root = await createInstalledPackage({
      server_url: `http://127.0.0.1:${address.port}`,
      model_uid: "qwen-test",
      api_key: "secret-value",
    })
    let adapter: CapturedAdapter | undefined
    const registerAdapter = vi.fn((_providers: string[], value: CapturedAdapter) => {
      adapter = value
      return vi.fn()
    })
    const registry = new MigratedModelRegistry(root)
    await registry.load()
    registry.register({
      get: (name: string) => name === "llm" ? { registerAdapter } : undefined,
      logger: { warn: vi.fn() },
    } as unknown as Context)

    expect(registerAdapter).toHaveBeenCalledWith(["dsh_model__langgenius__xinference__xinference"], expect.anything())
    expect(await adapter?.listModels("dsh_model__langgenius__xinference__xinference")).toEqual([
      expect.objectContaining({ id: "qwen-test" }),
    ])
    const chunks: Array<Record<string, unknown>> = []
    for await (const chunk of adapter!.stream({
      provider: "dsh_model__langgenius__xinference__xinference",
      model: "qwen-test",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    })) chunks.push(chunk)

    expect(requests).toEqual([expect.objectContaining({
      model: "qwen-test",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    })])
    expect(chunks).toContainEqual({ type: "text-delta", index: 0, text: "hello " })
    expect(chunks).toContainEqual({ type: "text-delta", index: 0, text: "from xinference" })
    expect(chunks).toContainEqual({ type: "block-end", index: 0, block: { type: "text", text: "hello from xinference" } })
    expect(chunks).toContainEqual({ type: "usage", usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 } })
    expect(chunks.at(-1)).toEqual({ type: "finish", reason: { kind: "stop" } })
    registry.disposeRegistrations()
  })

  it("test_stream_split_tool_calls_as_dsh_blocks", async () => {
    const requests: Array<Record<string, unknown>> = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>)
        response.writeHead(200, { "Content-Type": "text/event-stream" })
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "weather", arguments: "{\"city\":" } }] }, finish_reason: null }] })}\n\n`)
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"Beijing\"}" } }] }, finish_reason: "tool_calls" }] })}\n\n`)
        response.end("data: [DONE]\n\n")
      })
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("test server did not expose a port")

    const root = await createInstalledPackage({
      server_url: `http://127.0.0.1:${address.port}`,
      model_uid: "qwen-test",
    })
    let adapter: CapturedAdapter | undefined
    const registry = new MigratedModelRegistry(root)
    await registry.load()
    registry.register({
      get: () => ({ registerAdapter: (_providers: string[], value: CapturedAdapter) => { adapter = value; return vi.fn() } }),
      logger: { warn: vi.fn() },
    } as unknown as Context)

    const streamed: Array<Record<string, unknown>> = []
    for await (const chunk of adapter!.stream({
      provider: "dsh_model__langgenius__xinference__xinference",
      model: "qwen-test",
      messages: [
        { role: "assistant", content: [{ type: "tool-call", id: "prior_call", name: "weather", arguments: "{\"city\":\"Shanghai\"}" }] },
        {
          role: "user",
          source: { kind: "tool", callId: "prior_call" },
          content: [{ type: "tool-result", toolCallId: "prior_call", content: [{ type: "text", text: "sunny" }] }],
        },
        { role: "user", content: [{ type: "text", text: "weather?" }] },
      ],
      tools: [{ name: "weather", description: "Get weather", parameters: { type: "object" } }],
    })) streamed.push(chunk)

    expect(requests[0]).toMatchObject({
      stream: true,
      tools: [{ type: "function", function: { name: "weather", description: "Get weather" } }],
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "prior_call",
            type: "function",
            function: { name: "weather", arguments: "{\"city\":\"Shanghai\"}" },
          }],
        },
        { role: "tool", content: "sunny", tool_call_id: "prior_call" },
        { role: "user", content: "weather?" },
      ],
    })
    expect(streamed).toContainEqual({
      type: "tool-call-delta",
      index: 0,
      id: "call_1",
      name: "weather",
      argumentsDelta: "{\"city\":",
    })
    expect(streamed).toContainEqual({
      type: "block-end",
      index: 0,
      block: { type: "tool-call", id: "call_1", name: "weather", arguments: "{\"city\":\"Beijing\"}" },
    })
    expect(streamed.at(-1)).toEqual({ type: "finish", reason: { kind: "tool-calls" } })
    registry.disposeRegistrations()
  })

  it("test_keep_provider_registered_but_hide_models_when_required_credentials_are_missing", async () => {
    const root = await createInstalledPackage({})
    let adapter: CapturedAdapter | undefined
    const warn = vi.fn()
    const registry = new MigratedModelRegistry(root)
    await registry.load()
    registry.register({
      get: () => ({ registerAdapter: (_providers: string[], value: CapturedAdapter) => { adapter = value; return vi.fn() } }),
      logger: { warn },
    } as unknown as Context)

    expect(await adapter?.listModels("dsh_model__langgenius__xinference__xinference")).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("server_url"))
    registry.disposeRegistrations()
  })

  it("test_invoke_embedding_rerank_speech2text_and_tts_with_scoped_model_credentials", async () => {
    const requests: Array<{ url: string; authorization?: string; body: string }> = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8")
        requests.push({ url: request.url ?? "", authorization: request.headers.authorization, body })
        if (request.url === "/v1/embeddings") {
          response.writeHead(200, { "Content-Type": "application/json" })
          response.end(JSON.stringify({
            data: [{ index: 0, embedding: [3, 4] }, { index: 1, embedding: [0, 2] }],
            usage: { prompt_tokens: 3, total_tokens: 3 },
          }))
          return
        }
        if (request.url === "/v1/rerank") {
          response.writeHead(200, { "Content-Type": "application/json" })
          response.end(JSON.stringify({ results: [
            { index: 1, relevance_score: 0.9, document: { text: "second" } },
            { index: 0, relevance_score: 0.2, document: { text: "first" } },
          ] }))
          return
        }
        if (request.url === "/v1/audio/transcriptions") {
          response.writeHead(200, { "Content-Type": "application/json" })
          response.end(JSON.stringify({ text: "transcribed audio" }))
          return
        }
        if (request.url === "/v1/audio/speech") {
          response.writeHead(200, { "Content-Type": "audio/mpeg" })
          response.end(Buffer.from([1, 2, 3, 4]))
          return
        }
        response.writeHead(404).end()
      })
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("test server did not expose a port")

    const root = await createInstalledPackage({
      server_url: `http://127.0.0.1:${address.port}`,
      api_key: "secret-value",
      models: {
        "text-embedding": { model_uid: "bge-test" },
        rerank: { model_uid: "rerank-test" },
        speech2text: { model_uid: "whisper-test" },
        tts: { model_uid: "cosyvoice-test" },
      },
    })
    const registry = new MigratedModelRegistry(root)
    await registry.load()

    expect(registry.hasConfigured("text-embedding")).toBe(true)
    expect(registry.list()[0]?.configuredModelTypes).toEqual(["text-embedding", "rerank", "speech2text", "tts"])
    await expect(registry.embed({ texts: ["first", "second"] })).resolves.toMatchObject({
      model: "bge-test",
      embeddings: [[3, 4], [0, 2]],
      usage: { promptTokens: 3, totalTokens: 3 },
    })
    await expect(registry.rerank({ query: "query", documents: ["first", "second"], scoreThreshold: 0.5 })).resolves.toMatchObject({
      model: "rerank-test",
      results: [{ index: 1, text: "second", score: 0.9 }],
    })
    await expect(registry.speechToText({
      audio: Uint8Array.from([1, 2, 3]),
      fileName: "sample.wav",
      contentType: "audio/wav",
      language: "zh",
    })).resolves.toMatchObject({ model: "whisper-test", text: "transcribed audio" })
    const speech = await registry.textToSpeech({ input: "hello", voice: "中文女", responseFormat: "mp3" })
    expect(speech).toMatchObject({ model: "cosyvoice-test", contentType: "audio/mpeg" })
    expect([...speech.audio]).toEqual([1, 2, 3, 4])

    expect(requests.map((item) => item.url)).toEqual([
      "/v1/embeddings", "/v1/rerank", "/v1/audio/transcriptions", "/v1/audio/speech",
    ])
    expect(requests.every((item) => item.authorization === "Bearer secret-value")).toBe(true)
    expect(JSON.parse(requests[0]!.body)).toMatchObject({ model: "bge-test", input: ["first", "second"] })
    expect(JSON.parse(requests[1]!.body)).toMatchObject({ model: "rerank-test", query: "query", return_documents: true })
    expect(requests[2]!.body).toContain("whisper-test")
    expect(requests[2]!.body).toContain("sample.wav")
    expect(JSON.parse(requests[3]!.body)).toMatchObject({ model: "cosyvoice-test", input: "hello", voice: "中文女" })
  })
})

async function createInstalledPackage(credentials: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "visual-workflow-model-"))
  temporaryDirectories.push(root)
  const packageDirectory = join(root, "migrated-models", "dsh_dify__langgenius__xinference@0.0.17")
  await mkdir(packageDirectory, { recursive: true })
  await writeFile(join(packageDirectory, "dsh-model-package.json"), JSON.stringify({
    schemaVersion: 1,
    id: "dsh_dify__langgenius__xinference",
    name: "xinference",
    version: "0.0.17",
    description: "Xinference",
    origin: {
      platform: "dify",
      targetVersion: "1.13.3",
      packageId: "langgenius/xinference:0.0.17@test",
      sha256: "test",
      author: "langgenius",
      plugin: "xinference",
    },
    runtime: { kind: "openai-compatible-model-adapter", timeoutMs: 5000 },
    providers: [{
      ref: "dsh_model__langgenius__xinference__xinference",
      name: "xinference",
      label: "Xorbits Inference",
      description: "Xinference migrated from Dify",
      adapter: "xinference-openai-compatible",
      supportedModelTypes: ["llm", "text-embedding", "rerank", "speech2text", "tts"],
      credentials: [
        { name: "server_url", label: "Server URL", type: "text-input", required: true, secret: false },
        { name: "model_uid", label: "Model UID", type: "text-input", required: true, secret: false },
        { name: "api_key", label: "API key", type: "secret-input", required: false, secret: true },
      ],
    }],
  }))
  await writeFile(join(root, "migrated-model-credentials.json"), JSON.stringify({
    dsh_dify__langgenius__xinference: credentials,
  }))
  return root
}
