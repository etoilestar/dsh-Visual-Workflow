import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { WorkflowImportError, parseDifyWorkflow } from "../../../../../src/host/importer/index.js"

async function fixture(name: string): Promise<string> {
  return readFile(resolve("tests/fixtures/dify", name), "utf8")
}

describe("Dify workflow parser", () => {
  test("test_parse_basic_workflow_normalizes_graph_variables_and_model_dependency", async () => {
    const result = parseDifyWorkflow(await fixture("basic-llm.yml"))
    expect(result.workflow.nodes.map((node) => node.semanticKind)).toEqual(["start", "llm", "end"])
    expect(result.workflow.edges).toHaveLength(2)
    expect(result.workflow.variables).toContainEqual(expect.objectContaining({ name: "query", scope: "input", required: true }))
    expect(result.workflow.dependencies).toContainEqual(expect.objectContaining({ kind: "model", source: expect.objectContaining({ name: "sample-model" }) }))
    expect(result.workflow.nodes[1].inputs[0]?.references).toEqual([{ sourceNodeId: "start-node", sourcePort: "query" }])
    expect(result.workflow.nodes[1].outputs).toEqual([])
    expect(result.workflow.nodes[1].config.prompt_template).toEqual([
      { role: "system", text: "You are an assistant.\nAnswer according to the supplied context.\n" },
      { role: "user", text: "Question: {{#start-node.query#}}\n" },
    ])
  })

  test("test_parse_unknown_node_preserves_sanitized_raw_for_adaptive_mapping", async () => {
    const result = parseDifyWorkflow(await fixture("unknown-node.yml"))
    const node = result.workflow.nodes[1]
    expect(node.semanticKind).toBe("unknown")
    expect(node.source.type).toBe("some-new-router")
    expect(node.source.raw).toEqual(expect.objectContaining({ data: expect.objectContaining({ novel_config: "retained" }) }))
    expect(result.capabilities.unknownNodeTypes).toEqual(["some-new-router"])
  })

  test("test_parse_newer_dsl_accepts_unknown_fields_and_reports_capabilities", async () => {
    const result = parseDifyWorkflow(await fixture("newer-dsl.yml"))
    expect(result.workflow.nodes).toHaveLength(3)
    expect(result.capabilities.unknownFields).toEqual(["future_root_field"])
    expect(result.capabilities.dslVersion).toBe("0.1.0")
  })

  test("test_parse_http_credential_removes_secret_and_records_rebinding", async () => {
    const source = await fixture("http.yml")
    const result = parseDifyWorkflow(source)
    const serialized = JSON.stringify(result.workflow)
    expect(serialized).not.toContain("secret-token")
    expect(serialized).not.toContain("Authorization")
    expect(serialized).not.toContain("another-secret")
    expect(result.workflow.nodes[1].config).toEqual(expect.objectContaining({ max_tokens: 1024, token_limit: 4096 }))
    expect(result.workflow.dependencies).toContainEqual(expect.objectContaining({ kind: "credential", requiresCredential: true }))
  })

  test("test_parse_rag_collects_knowledge_dependency", async () => {
    const result = parseDifyWorkflow(await fixture("rag.yml"))
    expect(result.workflow.dependencies).toContainEqual(expect.objectContaining({ kind: "knowledge", source: expect.objectContaining({ name: "dataset-abc" }) }))
    expect(result.workflow.nodes[1].inputs).toContainEqual(expect.objectContaining({
      references: [{ sourceNodeId: "start-node", sourcePort: "query" }],
    }))
  })

  test("test_parse_dangling_edge_rejects_invalid_semantics", async () => {
    const source = (await fixture("basic-llm.yml")).replace("target: answer-node", "target: missing")
    expect(() => parseDifyWorkflow(source)).toThrowError(expect.objectContaining<Partial<WorkflowImportError>>({ code: "dangling_edge" }))
  })
})
