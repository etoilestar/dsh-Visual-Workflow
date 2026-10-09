import { afterEach, describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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
  it('test_file_binding_missing_blocks_before_parent_inference', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(withFile(), 'session-1')
    await expect(h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({ code: 'WF_INPUT_FILE_UNBOUND' })
    expect(h.agents.roots.get('session-1')!.messages).toHaveLength(0)
    expect(h.runtime.activeRunsForSession('session-1')).toHaveLength(0)
  })

  it('test_runtime_file_binding_is_readable_absolute_and_does_not_change_graph', async () => {
    const h = await makeHarness()
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
    const h = await makeHarness()
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
