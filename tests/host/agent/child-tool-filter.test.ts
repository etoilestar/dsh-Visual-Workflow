import { describe, expect, it } from "vitest"
import { createChildToolFilterSetup, installChildToolPolicy } from "../../../src/host/agent/child-tool-filter.js"

function scope(inherited = ["read", "write", "mcp__server__read"], own = ["send_message", "custom"]) {
  const guards: Array<(execution: { name: string }) => string | undefined> = []
  const masks: Array<{ allow?: string[]; deny?: string[] }> = []
  const tools = {
    get: (name: string) => own.includes(name) || (inherited.includes(name) && masks.every((mask) => (mask.allow === undefined || mask.allow.includes(name)) && !mask.deny?.includes(name))) ? {} : undefined,
    guard: (check: (execution: { name: string }) => string | undefined) => {
      guards.push(check)
      return () => { guards.splice(guards.indexOf(check), 1) }
    },
    restrict: (filter: { allow?: string[]; deny?: string[] }) => {
      const unknown = [...filter.allow ?? [], ...filter.deny ?? []].find((name) => !inherited.includes(name))
      if (unknown) throw new Error(`tools.restrict() names unknown global tool "${unknown}"`)
      masks.push(filter)
      return () => { masks.splice(masks.indexOf(filter), 1) }
    },
  }
  return { tools, context: { get: () => tools }, masks, guards, denied: (name: string) => guards.some((check) => check({ name }) !== undefined) }
}

describe("child scope permissions", () => {
  it("test_standard_scope_root_only_subagent_is_not_restricted", () => {
    const child = scope()
    installChildToolPolicy(child.context, ["read", "subagent", "mcp__server__read", "custom"])
    expect(child.masks).toEqual([{ allow: ["read", "mcp__server__read"] }])
    expect(child.denied("read")).toBe(false)
    expect(child.denied("custom")).toBe(false)
    expect(child.denied("mcp__server__read")).toBe(false)
    expect(child.denied("write")).toBe(true)
    expect(child.denied("wf_finish")).toBe(true)
    expect(child.denied("wf_graph_patch")).toBe(true)
  })

  it("test_empty_allow_denies_inherited_and_unapproved_own_tools", async () => {
    const setup = createChildToolFilterSetup()
    const child = scope()
    await setup.withPending([], async () => setup.contribution(child.context))
    expect(child.masks).toEqual([{ allow: [] }])
    expect(child.denied("read")).toBe(true)
    expect(child.denied("custom")).toBe(true)
    expect(child.denied("run_code")).toBe(false)
    expect(child.denied("send_message")).toBe(false)
  })

  it("test_unconfigured_allow_preserves_inheritance_but_denies_parent_tools", () => {
    const child = scope()
    installChildToolPolicy(child.context, undefined)
    expect(child.masks).toEqual([])
    expect(child.denied("read")).toBe(false)
    expect(child.denied("wf_finish")).toBe(true)
  })

  it("test_install_failure_aborts_creation_and_releases_contributions", async () => {
    const child = scope()
    const restrict = child.tools.restrict
    child.tools.restrict = (filter) => {
      if (filter.allow !== undefined) throw new Error("policy installation failed")
      return restrict(filter)
    }
    let dispatched = false
    await expect((async () => { installChildToolPolicy(child.context, ["read"]); dispatched = true })()).rejects.toThrow("白名单安装失败")
    expect(dispatched).toBe(false)
    expect(child.guards).toHaveLength(0)
    expect(child.masks).toHaveLength(0)
  })

  it("test_missing_tool_or_guard_fails_before_inference", () => {
    const child = scope()
    expect(() => installChildToolPolicy(child.context, ["ghost"])).toThrow("实际子代理作用域不可用")
    expect(() => installChildToolPolicy({ get: () => ({ restrict: () => () => {} }) }, [])).toThrow("无法安全启动")
    expect(child.guards).toHaveLength(0)
  })

  it("test_disposal_is_idempotent_and_own_tools_do_not_require_error_probes", () => {
    const child = scope()
    const dispose = installChildToolPolicy(child.context, ["custom", "read"])
    expect(child.guards).toHaveLength(1)
    expect(child.masks).toEqual([{ allow: ["read"] }])
    dispose()
    dispose()
    expect(child.guards).toHaveLength(0)
    expect(child.masks).toHaveLength(0)
  })

  it("test_empty_policy_survives_cold_restore_and_disposal", () => {
    const setup = createChildToolFilterSetup()
    setup.remember("child", [])
    const child = scope()
    const dispose = setup.restore("child", child.context)
    expect(child.masks).toEqual([{ allow: [] }])
    expect(child.denied("read")).toBe(true)
    dispose()
    expect(child.masks).toEqual([])
    expect(child.denied("read")).toBe(false)
    setup.remember("child", undefined)
    setup.restore("child", child.context)
    expect(child.masks).toEqual([])
  })
})
