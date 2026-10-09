// Optional integration check against an independently installed official DSH.
// No model mock, credential, or official runtime source patch is involved.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { installChildToolPolicy } from "../lib/agent/child-tool-filter.js"

const manifest = process.env.DSH_RUNTIME_PACKAGE
assert.ok(manifest, "Set DSH_RUNTIME_PACKAGE to the absolute path of @deepseek-ai/dsh/package.json")
const requireRuntime = createRequire(manifest)
const runtimeImport = (name) => import(pathToFileURL(requireRuntime.resolve(name)).href)
const [{ Context }, { SystemPrompt }, { ToolRuntime }, { createScope }] = await Promise.all([
  runtimeImport("@deepseek-ai/cordis"), runtimeImport("@deepseek-ai/dsh-system-prompt"),
  runtimeImport("@deepseek-ai/dsh-tools"), runtimeImport("@deepseek-ai/dsh-scope"),
])
const root = new Context()
const owned = []
try {
  await root.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false })
  await root.plugin(ToolRuntime, { mode: "native" })
  const definition = (name) => ({
    name, description: name, parameters: { type: "object", properties: {}, additionalProperties: false },
    output: { schema: { type: "null" }, render: () => [{ type: "text", text: "executed" }] },
    execute: async () => null,
  })
  for (const name of ["read", "write", "mcp__server__read", "wf_finish"]) root.get("tools").register(definition(name))
  const presetKey = {}
  const preset = createScope(root, presetKey)
  owned.push(preset)
  preset.ctx.get("tools").register(definition("str_replace_editor"))
  const parent = { id: "parent" }
  const parentScope = createScope(root, parent)
  owned.push(parentScope)
  parentScope.ctx.get("tools").register(definition("subagent"))
  let sequence = 0
  const invoke = (agent, name) => root.get("tools").execute({ callId: `scope-${++sequence}`, name, arguments: {}, agent, signal: new AbortController().signal })
  const child = { id: "child" }
  const scope = createScope(root, child, { parent: presetKey })
  owned.push(scope)
  for (const name of ["custom", "send_message", "wf_finish"]) scope.ctx.get("tools").register(definition(name))
  assert.equal(root.get("tools").get("subagent", child), undefined)
  assert.equal(root.get("tools").get("str_replace_editor", parent), undefined)
  assert.ok(root.get("tools").get("str_replace_editor", child))
  const dispose = installChildToolPolicy(scope.ctx, ["read", "subagent", "str_replace_editor", "mcp__server__read", "custom"], child)
  for (const name of ["read", "str_replace_editor", "mcp__server__read", "custom", "send_message"]) assert.equal((await invoke(child, name)).isError, false, `${name} must execute`)
  for (const name of ["write", "wf_finish"]) assert.equal((await invoke(child, name)).isError, true, `${name} must be denied`)
  dispose()
  const empty = installChildToolPolicy(scope.ctx, [], child)
  for (const name of ["read", "custom", "wf_finish"]) assert.equal((await invoke(child, name)).isError, true, `empty policy must deny ${name}`)
  assert.equal((await invoke(child, "send_message")).isError, false)
  empty()
  const unconfigured = installChildToolPolicy(scope.ctx, undefined, child)
  assert.equal((await invoke(child, "read")).isError, false)
  assert.equal((await invoke(child, "wf_finish")).isError, true)
  unconfigured()
  assert.throws(() => installChildToolPolicy(scope.ctx, ["ghost"], child), /实际子代理作用域不可用/)
  assert.equal((await invoke(child, "custom")).isError, true, "failed installation must remain closed")
  console.log(JSON.stringify({ status: "passed", runtime: "@deepseek-ai/dsh-tools", actualScopedExecutions: sequence }))
} finally {
  for (const scope of owned.reverse()) await scope.dispose()
  await root.fiber.dispose()
}
