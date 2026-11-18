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
      supportedModelTypes: ["llm"],
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
