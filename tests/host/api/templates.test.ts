// tests/host/api/templates.test.ts
//
// 模板与工作流模板端点的边界职责（api/templates.ts）：kind 参数校验（400）、
// 删除 404、revision 乐观锁（409）、删除预览的解耦语义。

import { afterEach, describe, expect, it } from 'vitest'
import { cleanupAll, makeHarness } from './fixtures/api-harness.js'
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { runtimeManagedPrefix } from "../../../src/host/storage/managed-files.js"
import { runtimeInputsOf } from "../../../src/host/orchestrator/runtime-inputs.js"
import { makeFlow } from "./fixtures/api-harness.js"

afterEach(cleanupAll)

it("test_session_upload_namespace_binding_and_legacy_template_upload_remain_compatible", async () => {
  const h = await makeHarness()
  const args = { name: "source.txt", base64: Buffer.from("data").toString("base64") }
  const uploaded = await h.api.handle("fileUpload", { ...args, sessionId: "session-1" }) as { managedPath: string; fileName: string }
  expect(uploaded.fileName).toBe(`${runtimeManagedPrefix("session-1")}source.txt`)
  const raw = { nodeInputs: { "n-a1": { source: [{ kind: "file", fileRef: { source: "managed", path: uploaded.managedPath } }] } } }
  const access = { sessionId: "session-1", managedRoot: h.dataDir, files: [] }
  expect((await runtimeInputsOf(raw, makeFlow(), access)).nodeInputs["n-a1"].source[0]).toMatchObject({ fileRef: { path: join(h.dataDir, uploaded.managedPath) } })
  await expect(runtimeInputsOf(raw, makeFlow(), { ...access, sessionId: "other" })).rejects.toMatchObject({ code: "WF_INPUT_FILE_UNAUTHORIZED" })
  await expect(h.api.handle("fileUpload", { ...args, name: uploaded.fileName })).rejects.toMatchObject({ code: "WF_INPUT_FILE_UNAUTHORIZED" })
  expect(await readFile(join(h.dataDir, uploaded.managedPath), "utf8")).toBe("data")
  const legacy = await h.api.handle("fileUpload", args) as { managedPath: string; fileName: string }
  expect(legacy).toEqual({ managedPath: "data/files/source.txt", fileName: "source.txt" })
  expect(await readFile(join(h.dataDir, legacy.managedPath), "utf8")).toBe("data")
})

it.each(["", " ", 1, null])("test_upload_invalid_session_identifier_%j_is_rejected", async (sessionId) => {
  const h = await makeHarness()
  await expect(h.api.handle("fileUpload", { sessionId, name: "file.txt", base64: "ZGF0YQ==" })).rejects.toMatchObject({ status: 400 })
})

describe('模板端点（角色/文件/数据库）', () => {
  it('模板 CRUD 与删除预览（解耦语义：受影响节点恒为 0）', async () => {
    const h = await makeHarness()
    await expect(h.api.handle('listTemplates', { kind: 'bad' })).rejects.toMatchObject({ status: 400 })
    const saved = (await h.api.handle('putTemplate', {
      kind: 'role',
      template: { id: 'role-1', kind: 'agent', name: '研究员', systemPrompt: 'x', provider: '', model: '', presetId: 'standard', retryLimit: 3 },
    })) as { id?: string }
    expect(saved.id).toBe('role-1')
    const list = (await h.api.handle('listTemplates', { kind: 'role' })) as unknown[]
    expect(list).toHaveLength(1)

    const preview = await h.api.handle('deleteTemplatePreview', { kind: 'role', id: 'role-1' })
    expect(preview).toEqual({ affectedNodes: 0, detached: true })

    const deleted = await h.api.handle('deleteTemplate', { kind: 'role', id: 'role-1' })
    expect(deleted).toEqual({ deleted: true })
    await expect(h.api.handle('deleteTemplate', { kind: 'role', id: 'role-1' })).rejects.toMatchObject({ status: 404 })
  })
})

describe('工作流模板端点', () => {
  it('工作流模板端点 CRUD（图2 改造：全局共享，无会话隔离）', async () => {
    const h = await makeHarness()
    // 初态为空
    expect(await h.api.handle('listFlowTemplates', {})).toEqual([])

    // 保存（revision 0 → 1）
    const saved = (await h.api.handle('putFlowTemplate', {
      template: { id: 'tpl-1', mode: 'mode1', name: '流程模板', description: 'd', revision: 0, nodes: [], lines: [] },
    })) as { id?: string; revision?: number }
    expect(saved.id).toBe('tpl-1')
    expect(saved.revision).toBe(1)

    // 乐观锁：携带过期的 expected revision 保存被拒（409）
    await expect(h.api.handle('putFlowTemplate', {
      template: { id: 'tpl-1', mode: 'mode1', name: '旧快照', description: '', revision: 99, nodes: [], lines: [] },
    })).rejects.toMatchObject({ status: 409 })

    // 列表可见（无 sessionId 参数——全局共享）
    const list = (await h.api.handle('listFlowTemplates', {})) as unknown[]
    expect(list).toHaveLength(1)

    // 删除与 404
    expect(await h.api.handle('deleteFlowTemplate', { id: 'tpl-1' })).toEqual({ deleted: true })
    await expect(h.api.handle('deleteFlowTemplate', { id: 'tpl-1' })).rejects.toMatchObject({ status: 404 })
  })
})
