import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { buildNodeBlocks } from '../../../src/host/orchestrator/task-blocks.js'
import { caller, cleanupTempDirs, makeHarness, makeFlow, fileNode, start } from './fixtures/harness.js'

afterEach(cleanupTempDirs)

function withFile() {
  const flow = makeFlow()
  flow.nodes.push(fileNode('csv', '销售输入', { fileKind: 'file' }))
  flow.lines.push({ id: 'csv-ctx', source: 'csv', target: 'n-a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' })
  return flow
}

describe('explicit execution inputs and artifacts', () => {
  it.each([undefined, {}, { inputSource: "workspace" as const, requiredFiles: ["shared.txt"] }])("test_text_and_workspace_tasks_keep_soft_schemas_and_empty_output_without_ctx_or_output_files_%j", async (execution) => {
    const h = await makeHarness(undefined, { workingDirectory: async () => h.dir })
    await writeFile(join(h.dir, "shared.txt"), "shared workspace")
    const flow = makeFlow()
    const node = flow.nodes.find((node) => node.id === "n-a1")!
    if (node.kind !== "agent") throw new Error("fixture")
    node.data.execution = execution
    node.data.inputSchema = "自由文本或工作区信息"
    node.data.outputSchema = "允许纯文本或工具副作用，无返回文本也可结束"
    await start(h, flow)
    await h.runtime.wfRunNode(caller, { nodeId: node.id })
    await h.runtime.handleSubagentEnd({ id: "child-1", stopReason: "completed" })
    await h.runtime.wfFinish(caller, { status: "completed" })
    expect((await h.store.getRun("run-1"))!.status).toBe("completed")
    expect((await h.store.getWorkflow("session-1", flow.id))!.nodes.find((entry) => entry.id === node.id)).toMatchObject({ data: { inputSchema: node.data.inputSchema, outputSchema: node.data.outputSchema } })
  })

  it("test_output_authorization_is_rechecked_after_directory_symlink_swap", async () => {
    const outside = await makeHarness()
    await writeFile(join(outside.dir, "result.txt"), "external")
    const h = await makeHarness(undefined, { workingDirectory: async () => h.dir })
    await mkdir(join(h.dir, "output"))
    const flow = makeFlow()
    const node = flow.nodes.find((node) => node.id === "n-a1")!
    if (node.kind !== "agent") throw new Error("fixture")
    node.data.execution = { outputFiles: ["output/result.txt"] }
    await start(h, flow)
    await h.runtime.wfRunNode(caller, { nodeId: node.id })
    await rm(join(h.dir, "output"), { recursive: true })
    await symlink(outside.dir, join(h.dir, "output"))
    await h.runtime.handleSubagentEnd({ id: "child-1", stopReason: "completed" })
    const record = (await h.store.getRun("run-1"))!.nodes.find((entry) => entry.nodeId === node.id)!
    expect(record).toMatchObject({ status: "fail", failure: { code: "WF_OUTPUT_PATH_UNWRITABLE" } })
    expect(record.artifacts).toBeUndefined()
  })
  it("test_managed_multiple_files_without_workspace_keep_existing_managed_path_semantics", async () => {
    const h = await makeHarness()
    await mkdir(join(h.dir, "data/files"), { recursive: true })
    const paths = ["data/files/one.txt", "data/files/two.txt"]
    for (const path of paths) await writeFile(join(h.dir, path), path)
    const flow = withFile()
    const file = flow.nodes.find((node) => node.id === "csv")!
    if (file.kind !== "file") throw new Error("fixture")
    file.data.managedPath = paths[0]
    file.data.files = paths.map((managedPath) => ({ managedPath, fileName: managedPath }))
    await start(h, flow)
    await h.runtime.wfRunNode(caller, { nodeId: "n-a1" })
    for (const path of paths) expect(h.runner.calls[0].blocks[0].text).toContain(join(h.dir, path))
  })

  it.each(["absolute", "traversal", "symlink"])("test_unauthorized_%s_input_cannot_dispatch_parent", async (kind) => {
    const outside = await makeHarness()
    const path = join(outside.dir, "private.txt")
    await writeFile(path, "private")
    const h = await makeHarness(undefined, { workingDirectory: async () => h.dir })
    let binding = path
    if (kind === "traversal") binding = relative(h.dir, path)
    if (kind === "symlink") { binding = join(h.dir, "alias.txt"); await symlink(path, binding) }
    await h.store.saveWorkflow(withFile(), "session-1")
    await expect(h.runtime.startRun({ sessionId: "session-1", flowId: "flow-1", fileBindings: { csv: [binding] } })).rejects.toMatchObject({ code: "WF_INPUT_FILE_UNAUTHORIZED" })
    expect(h.agents.roots.get("session-1")!.messages).toHaveLength(0)
    expect(h.runner.calls).toHaveLength(0)
  })

  it("test_official_attachment_authorization_is_exact_and_rechecked_before_child_dispatch", async () => {
    const outside = await makeHarness()
    const path = join(outside.dir, "admitted.txt")
    const other = join(outside.dir, "other.txt")
    await writeFile(path, "admitted")
    await writeFile(other, "not admitted")
    let authorized = [path]
    const h = await makeHarness(undefined, { authorizedInputFiles: async () => authorized })
    await h.store.saveWorkflow(withFile(), "session-1")
    await expect(h.runtime.startRun({ sessionId: "session-1", flowId: "flow-1", fileBindings: { csv: [other] } })).rejects.toMatchObject({ code: "WF_INPUT_FILE_UNAUTHORIZED" })
    const { runId } = await h.runtime.startRun({ sessionId: "session-1", flowId: "flow-1", fileBindings: { csv: [path] } })
    expect(h.runtime.runSnapshot(runId)!.fileBindings).toEqual({ csv: [path] })
    authorized = []
    await expect(h.runtime.wfRunNode(caller, { nodeId: "n-a1" })).rejects.toMatchObject({ code: "WF_INPUT_FILE_UNAUTHORIZED" })
    expect(h.runner.calls).toHaveLength(0)
  })

  it("test_preexisting_output_is_stale_until_current_attempt_writes_it", async () => {
    const h = await makeHarness(undefined, { workingDirectory: async () => h.dir })
    const path = join(h.dir, "result.txt")
    await writeFile(path, "previous run")
    const flow = makeFlow()
    const node = flow.nodes.find((node) => node.id === "n-a1")!
    if (node.kind !== "agent") throw new Error("fixture")
    node.data.execution = { outputFiles: ["result.txt"] }
    await start(h, flow)
    await h.runtime.wfRunNode(caller, { nodeId: node.id })
    await h.runtime.handleSubagentEnd({ id: "child-1", stopReason: "completed" })
    expect((await h.store.getRun("run-1"))!.nodes.find((entry) => entry.nodeId === node.id)).toMatchObject({ status: "fail", failure: { code: "WF_OUTPUT_FILE_STALE" } })
    await h.runtime.wfRunNode(caller, { nodeId: node.id })
    await writeFile(path, "current run")
    await h.runtime.handleSubagentEnd({ id: "child-2", stopReason: "completed" })
    expect((await h.store.getRun("run-1"))!.nodes.find((entry) => entry.nodeId === node.id)).toMatchObject({ status: "ok", artifacts: [{ path, size: 11 }] })
  })

  it("test_declared_output_symlink_cannot_escape_workspace", async () => {
    const outside = await makeHarness()
    const h = await makeHarness(undefined, { workingDirectory: async () => h.dir })
    await symlink(outside.dir, join(h.dir, "outside"))
    const flow = makeFlow()
    const node = flow.nodes.find((node) => node.id === "n-a1")!
    if (node.kind !== "agent") throw new Error("fixture")
    node.data.execution = { outputFiles: ["outside/report.txt"] }
    await start(h, flow)
    await expect(h.runtime.wfRunNode(caller, { nodeId: node.id })).rejects.toMatchObject({ code: "WF_OUTPUT_PATH_UNWRITABLE" })
    expect(h.runner.calls).toHaveLength(0)
  })
  it('test_file_binding_missing_blocks_before_parent_inference', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(withFile(), 'session-1')
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_INPUT_FILE_UNBOUND' })
    expect(h.agents.roots.get('session-1')!.messages).toHaveLength(0)
    expect(h.runtime.activeRunsForSession('session-1')).toHaveLength(0)
  })

  it('test_runtime_file_binding_is_readable_absolute_and_does_not_change_graph', async () => {
    const h = await makeHarness(undefined, { workingDirectory: async () => h.dir })
    const path = join(h.dir, 'actual.csv')
    await writeFile(path, 'id,amount\nS001,6000\n')
    const flow = withFile()
    await h.store.saveWorkflow(flow, 'session-1')
    await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1', fileBindings: { csv: [path] } })
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    expect(h.runner.calls[0].blocks[0].text).toContain(path)
    expect(h.runner.calls[0].blocks[0].text).toContain('路径存在不代表已读取内容')
    expect((await h.store.getWorkflow('session-1', 'flow-1'))!.nodes.find((node) => node.id === 'csv')).toEqual(flow.nodes.find((node) => node.id === 'csv'))
    expect((await h.store.getRun('run-1'))!.fileBindings).toEqual({ csv: [path] })
  })

  it('test_relative_file_binding_requires_actual_session_cwd', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(withFile(), 'session-1')
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1', fileBindings: { csv: ['sales.csv'] } })).rejects.toMatchObject({ code: 'WF_INPUT_PATH_UNRESOLVED' })
    const relative = await makeHarness(undefined, { workingDirectory: async () => h.dir })
    await writeFile(join(h.dir, 'sales.csv'), 'id,amount\n')
    await relative.store.saveWorkflow(withFile(), 'session-1')
    await relative.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1', fileBindings: { csv: ['sales.csv'] } })
    expect(relative.runtime.runSnapshot('run-1')!.fileBindings).toEqual({ csv: [join(h.dir, 'sales.csv')] })
  })

  it('test_missing_and_malformed_files_are_actionable_without_parent_dispatch', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(withFile(), 'session-1')
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1', fileBindings: { csv: [join(h.dir, 'absent.csv')] } })).rejects.toMatchObject({ code: 'WF_INPUT_FILE_UNAVAILABLE' })
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1', fileBindings: { nonexistent: ['/file'] } })).rejects.toMatchObject({ code: 'WF_BAD_FILE_BINDINGS' })
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1', fileBindings: [] })).rejects.toMatchObject({ code: 'WF_BAD_FILE_BINDINGS' })
    expect(h.agents.roots.get('session-1')!.messages).toHaveLength(0)
  })

  it('test_required_ctx_missing_is_persisted_and_never_substituted_with_flow_history', async () => {
    const h = await makeHarness()
    const flow = makeFlow()
    const node = flow.nodes.find((node) => node.id === 'n-a2')!
    if (node.kind !== 'agent') throw new Error('fixture')
    node.data.execution = { inputSource: 'ctx' }
    await start(h, flow)
    await expect(h.runtime.wfRunNode(caller, { nodeId: node.id })).rejects.toMatchObject({ code: 'WF_INPUT_CONTEXT_MISSING' })
    expect(h.runner.calls).toHaveLength(0)
    expect((await h.store.getRun('run-1'))!.nodes.find((entry) => entry.nodeId === node.id)).toMatchObject({ status: 'fail', attempts: 1, failure: { phase: 'node_input', code: 'WF_INPUT_CONTEXT_MISSING' } })
  })

  it('test_completed_reply_does_not_replace_actual_output_file', async () => {
    const logs: string[] = []
    const h = await makeHarness(undefined, { workingDirectory: async () => h.dir, logger: { info: (message) => logs.push(message), warn: () => {}, debug: () => {} } })
    const flow = makeFlow()
    const node = flow.nodes.find((node) => node.id === 'n-a1')!
    if (node.kind !== 'agent') throw new Error('fixture')
    node.data.execution = { outputFiles: ['report.md'] }
    await start(h, flow)
    await h.runtime.wfRunNode(caller, { nodeId: node.id })
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '报告已生成 report.md' }] })
    expect((await h.store.getRun('run-1'))!.nodes.find((entry) => entry.nodeId === node.id)).toMatchObject({ status: 'fail', failure: { code: 'WF_OUTPUT_FILE_MISSING' } })
    expect(logs.map((message) => JSON.parse(message)).find((event) => event.phase === 'settled')).toMatchObject({ nodeId: node.id, errorCode: 'WF_OUTPUT_FILE_MISSING', status: 'fail' })
    await h.runtime.wfRunNode(caller, { nodeId: node.id })
    await writeFile(join(h.dir, 'report.md'), '# 实际报告')
    await h.runtime.handleSubagentEnd({ id: 'child-2', stopReason: 'completed' })
    expect((await h.store.getRun('run-1'))!.nodes.find((entry) => entry.nodeId === node.id)).toMatchObject({ status: 'ok', attempts: 2, artifacts: [{ path: join(h.dir, 'report.md'), size: Buffer.byteLength('# 实际报告') }] })
  })

  it('test_parent_success_claim_cannot_override_failed_declared_artifact', async () => {
    const h = await makeHarness(undefined, { workingDirectory: async () => h.dir })
    const flow = makeFlow()
    const node = flow.nodes.find((node) => node.id === 'n-a1')!
    if (node.kind !== 'agent') throw new Error('fixture')
    node.data.execution = { outputFiles: [join(h.dir, 'missing.md')] }
    await start(h, flow)
    await h.runtime.wfRunNode(caller, { nodeId: node.id })
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: '已生成' }] })
    await h.runtime.wfFinish(caller, { status: 'completed', summary: '全部成功' })
    expect((await h.store.getRun('run-1'))!).toMatchObject({ status: 'failed', summary: expect.stringContaining('n-a1'), termination: { source: 'parent_finish' } })
  })

  it('test_full_successful_ctx_checkpoint_preserved_without_implicit_flow_context', async () => {
    const h = await makeHarness({ documentTextLimit: 20000, outputFullLimit: 20000 })
    const flow = makeFlow()
    flow.lines.push({ id: 'ctx', source: 'n-a1', target: 'n-a2', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' })
    await start(h, flow)
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a1' })
    const output = '真实交接'.repeat(2000)
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: output }] })
    await h.runtime.stopRun('run-1')
    await h.runtime.resumeRun({ sessionId: 'session-1', flowId: 'flow-1' })
    await h.runtime.wfRunNode(caller, { nodeId: 'n-a2' })
    expect(h.runner.calls.at(-1)!.blocks[0].text).toContain(output)
    const plain = { ...flow, lines: flow.lines.filter((line) => line.id !== 'ctx') }
    const node = flow.nodes.find((node) => node.id === 'n-a2')!
    if (node.kind !== 'agent') throw new Error('fixture')
    expect(buildNodeBlocks({ flow: plain, node, snapshot: h.runtime.runSnapshot('run-2')!, documentTextLimit: 20000, systemLanguage: '中文' })[0].text).not.toContain(output)
  })
})
