import { expect, it } from "vitest"
import { runtimeDefinitionOf, parseExecutionContract } from "../../../src/host/graph/index.js"

it("test_versioned_runtime_preserves_opt_in_policy_requirements_and_budgets", () => {
  expect(runtimeDefinitionOf(undefined)).toBeUndefined()
  const runtime = { version: 1, handoffPolicy: "auto", inputs: { text: { kind: "text", required: false, source: { workflowInput: "subject" } }, file: { kind: "file", source: { nodeId: "upstream", output: "artifact" } } }, budget: { executionTimeoutMs: 100, parentCallLimit: 4, nodeExecutionLimit: 3, tokenLimit: 200, repeatedFailureLimit: 2 } }
  expect(runtimeDefinitionOf(runtime)).toEqual(runtime)
})
it.each([
  [null, "对象"], [{ version: 2 }, "version"], [{ version: 1, handoffPolicy: "guess" }, "handoffPolicy"], [{ version: 1, budget: { arbitrary: 1 } }, "arbitrary"], [{ version: 1, budget: { tokenLimit: 0 } }, "tokenLimit"], [{ version: 1, inputs: { "": {} } }, "名称"], [{ version: 1, inputs: { input: { kind: "arbitrary" } } }, "kind"], [{ version: 1, inputs: { input: { required: 1 } } }, "required"], [{ version: 1, inputs: { input: { source: { nodeId: "a", workflowInput: "b" } } } }, "source"],
] as const)("test_invalid_runtime_%j_has_field_diagnostic", (input, message) => { expect(() => runtimeDefinitionOf(input)).toThrow(message) })
it("test_node_contract_nested_schema_preserves_verifiable_constraints", () => {
  const execution = { inputs: { input: { kind: "json", source: { nodeId: "a" } } }, outputs: { output: { kind: "json", schema: { type: "object", required: ["items"], additionalProperties: false, properties: { items: { type: "array", minItems: 1, items: { type: "string", minLength: 2, enum: ["ok", "yes"] } }, count: { type: "integer", minimum: 0 } } } }, optional: { kind: "file", required: false, path: "output.txt" } }, completion: "verified" }
  expect(parseExecutionContract(execution)).toEqual({ value: execution })
})
it.each([
  [{ outputs: { x: { kind: "file" } } }, "path"], [{ outputs: { x: { kind: "bad" } } }, "kind"], [{ outputs: { x: { kind: "text", required: 1 } } }, "required"], [{ outputs: { x: { kind: "json", schema: { type: "any" } } } }, "type"], [{ outputs: { x: { kind: "json", schema: { type: "object", unexpected: true } } } }, "unexpected"], [{ outputs: { x: { kind: "json", schema: { type: "string", properties: {} } } } }, "object"], [{ outputs: { x: { kind: "json", schema: { type: "string", items: {} } } } }, "array"], [{ outputs: { x: { kind: "json", schema: { type: "integer", minLength: 1 } } } }, "minLength"], [{ outputs: { x: { kind: "json", schema: { type: "string", minimum: 1 } } } }, "minimum"], [{ outputs: { x: { kind: "json", schema: { type: "object", required: [1] } } } }, "required"], [{ outputs: { x: { kind: "json", schema: { type: "object", additionalProperties: 1 } } } }, "additionalProperties"], [{ outputs: { x: { kind: "json", schema: { type: "string", enum: [] } } } }, "enum"], [{ outputs: { x: { kind: "json", schema: { type: "array", minItems: -1 } } } }, "minItems"], [{ completion: "guess" }, "completion"],
] as const)("test_invalid_execution_%j_is_not_silently_accepted", (execution, field) => { expect(parseExecutionContract(execution).issue).toContain(field) })
