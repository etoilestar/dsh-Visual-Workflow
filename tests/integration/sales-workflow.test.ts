// Deterministic runtime integration: the runner is a test double; all file IO,
// intermediate products, ctx handoffs, persistence and finish are real.
import { afterEach, expect, it } from 'vitest'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NodeStartInput } from '../../src/host/orchestrator/index.js'
import { agent, stage, fileNode, makeFlow, makeHarness, caller, cleanupTempDirs } from '../host/orchestrator/fixtures/harness.js'

afterEach(cleanupTempDirs)

it('provided sales CSV: five real file-processing stages with explicit ctx handoffs and verified report', async () => {
  const h = await makeHarness({ documentTextLimit: 20000, outputFullLimit: 20000 }, { workingDirectory: async () => h.dir })
  const ids = ['load_data', 'quality_check', 'sales_stats', 'summary_gen', 'report_gen']
  const flow = makeFlow()
  flow.nodes = [stage('start', 'start'), ...ids.map((id, index) => agent(id, id, {
    presetId: 'standard',
    execution: { inputSource: 'ctx', outputFiles: [`output/${['raw.json', 'quality.json', 'stats.json', 'summary.md', 'final_report.md'][index]}`] },
  })), stage('end', 'end'), fileNode('csv', '用户提供的销售数据', { fileKind: 'file' })]
  const chain = ['start', ...ids, 'end']
  flow.lines = chain.slice(1).map((target, index) => ({ id: `flow-${index}`, source: chain[index], target, sourceHandle: 'flow-out', targetHandle: 'flow-in' }))
  flow.lines.push(...['csv', ...ids.slice(0, -1)].map((source, index) => ({ id: `ctx-${index}`, source, target: ids[index], sourceHandle: 'ctx-out' as const, targetHandle: 'ctx-in' as const })))
  const csv = join(h.dir, 'sales_workflow_test.csv')
  await copyFile(fileURLToPath(new URL('../fixtures/sales_workflow_test.csv', import.meta.url)), csv)
  await mkdir(join(h.dir, 'output'))
  const outputs = new Map<string, string>()
  const actualReads: string[] = []
  h.runner.startNodeTask = async (input: NodeStartInput) => {
    h.runner.calls.push(input)
    const id = input.node.id
    const index = ids.indexOf(id)
    const previous = index > 0 ? outputs.get(ids[index - 1])! : csv
    expect(input.blocks[0].text).toContain(previous)
    const read = async (path: string) => { actualReads.push(path); return readFile(path, 'utf8') }
    let content: string
    let output: string
    if (id === 'load_data') {
      const [header, ...lines] = (await read(csv)).trim().split(/\r?\n/)
      const keys = header.split(',')
      const rows = lines.map((line) => Object.fromEntries(line.split(',').map((value, i) => [keys[i], value])))
      expect(rows).toHaveLength(11)
      content = JSON.stringify(rows)
      output = 'output/raw.json'
    } else if (id === 'quality_check') {
      const rows = JSON.parse(await read(previous)) as Array<Record<string, string>>
      const seen = new Set<string>()
      let duplicates = 0
      const unique = rows.filter((row) => { const key = JSON.stringify(row); if (seen.has(key)) { duplicates++; return false }; seen.add(key); return true })
      const missingCells = rows.flatMap(Object.values).filter((value) => value === '').length
      const valid = unique.filter((row) => Object.values(row).every((value) => value !== ''))
      content = JSON.stringify({ records: rows.length, duplicates, missingCells, valid })
      output = 'output/quality.json'
    } else if (id === 'sales_stats') {
      const quality = JSON.parse(await read(previous)) as { records: number; duplicates: number; missingCells: number; valid: Array<Record<string, string>> }
      const sorted = [...quality.valid].sort((a, b) => Number(a.sales_amount) - Number(b.sales_amount))
      const total = quality.valid.reduce((sum, row) => sum + Number(row.sales_amount), 0)
      content = JSON.stringify({ records: quality.records, duplicates: quality.duplicates, missingCells: quality.missingCells, valid: quality.valid.length, total, average: (total / quality.valid.length).toFixed(2), maximum: { id: sorted.at(-1)!.order_id, amount: Number(sorted.at(-1)!.sales_amount) }, minimum: { id: sorted[0].order_id, amount: Number(sorted[0].sales_amount) } })
      output = 'output/stats.json'
    } else if (id === 'summary_gen') {
      const stats = JSON.parse(await read(previous))
      content = `数据记录：${stats.records}\n完全重复记录：${stats.duplicates}\n缺失单元格：${stats.missingCells}\n有效销售记录：${stats.valid}\n总销售额：${stats.total}\n平均单条销售额：${stats.average}\n最大销售记录：${stats.maximum.amount}（${stats.maximum.id}）\n最小销售记录：${stats.minimum.amount}（${stats.minimum.id}）`
      output = 'output/summary.md'
    } else {
      content = `# 销售分析报告\n\n${await read(previous)}\n\n已剔除完全重复记录和包含缺失值的记录。\n`
      output = 'output/final_report.md'
    }
    const path = join(h.dir, output)
    await writeFile(path, content)
    outputs.set(id, path)
    return { childId: `sales-${id}`, created: true }
  }
  await h.store.saveWorkflow(flow, 'session-1')
  const { runId } = await h.runtime.startRun({ sessionId: 'session-1', flowId: flow.id, fileBindings: { csv: [csv] } })
  for (const nodeId of ids) {
    await h.runtime.wfRunNode(caller, { nodeId })
    await h.runtime.handleSubagentEnd({ id: `sales-${nodeId}`, stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: outputs.get(nodeId)! }] })
  }
  expect(actualReads).toEqual([csv, ...ids.slice(0, -1).map((id) => outputs.get(id)!)])
  const stats = JSON.parse(await readFile(outputs.get('sales_stats')!, 'utf8'))
  expect(stats).toEqual({ records: 11, duplicates: 1, missingCells: 2, valid: 9, total: 15900, average: '1766.67', maximum: { id: 'S001', amount: 6000 }, minimum: { id: 'S010', amount: 200 } })
  await h.runtime.wfFinish(caller, { status: 'completed', summary: '五个节点完成；报告已落盘并核验' })
  const snapshot = (await h.store.getRun(runId))!
  expect(snapshot.status).toBe('completed')
  expect(snapshot.nodes.filter((node) => ids.includes(node.nodeId))).toHaveLength(5)
  for (const node of snapshot.nodes.filter((node) => ids.includes(node.nodeId))) {
    expect(node).toMatchObject({ status: 'ok', attempts: 1, stopReason: 'completed', artifacts: [{ path: outputs.get(node.nodeId), size: expect.any(Number), verifiedAt: expect.any(String) }] })
  }
  const report = await readFile(join(h.dir, 'output/final_report.md'), 'utf8')
  for (const expected of ['数据记录：11', '完全重复记录：1', '缺失单元格：2', '有效销售记录：9', '总销售额：15900', '1766.67', '6000（S001）', '200（S010）']) expect(report).toContain(expected)
  expect(h.runtime.activeRunsForSession('session-1')).toHaveLength(0)
})
