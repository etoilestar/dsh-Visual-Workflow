import { expect, it } from "vitest"
import { buildNodeResult } from "../../../src/host/orchestrator/node-results.js"
import { createRunSnapshot, setNodeStatus } from "../../../src/host/orchestrator/snapshot.js"
import { agent, makeFlow } from "./fixtures/harness.js"
import type { NodeExecutionContract } from "../../../src/host/shared/graph-model.js"

function build(execution: NodeExecutionContract | undefined, text: string) {
  const node = agent("n-a1", "task", { execution })
  const snapshot = createRunSnapshot({ runId: "run-1", sessionId: "session-1", flow: makeFlow(), mode: "mode1", now: 1000 })
  setNodeStatus(snapshot, node.id, "running", { attempts: 1, childId: "child-1", now: 1000 })
  return buildNodeResult(node, snapshot, text, "child-1")
}

it("test_result_legacy_reply_is_turn_confirmation_without_file_requirement", () => {
  expect(build(undefined, "done")).toMatchObject({ status: "succeeded", confirmation: "turn", outputs: { response: "done" }, artifacts: [] })
})

it("test_result_named_text_json_and_null_are_verified_without_coercion", () => {
  expect(build({ outputs: { summary: { kind: "text" }, data: { kind: "json", schema: { type: "null" } } } }, '{"outputs":{"summary":"done","data":null}}')).toMatchObject({ confirmation: "verified", outputs: { summary: "done", data: null } })
})

it("test_result_direct_json_schema_checks_nested_fields", () => {
  const contract: NodeExecutionContract = { outputs: { data: { kind: "json", schema: { type: "object", required: ["values"], additionalProperties: false, properties: { values: { type: "array", minItems: 1, items: { type: "integer", minimum: 0 } } } } } } }
  expect(build(contract, '{"values":[2]}').outputs.data).toEqual({ values: [2] })
  for (const text of ['{}', '{"values":[]}', '{"values":[-1]}', '{"values":[0.5]}', '{"values":[1],"extra":2}']) expect(() => build(contract, text)).toThrow(expect.objectContaining({ code: "WF_OUTPUT_INVALID", retryable: false, details: expect.any(Array) }))
})

it.each(["", "please provide missing data", '{"wrong":1}'])("test_result_required_json_unfulfilled_%s_does_not_succeed", (text) => {
  expect(() => build({ outputs: { data: { kind: "json", schema: { type: "object", required: ["total"] } } } }, text)).toThrow(expect.objectContaining({ code: "WF_OUTPUT_INVALID" }))
})

it("test_result_optional_missing_output_allowed_but_present_invalid_output_rejected", () => {
  const contract: NodeExecutionContract = { outputs: { main: { kind: "text" }, optional: { kind: "json", required: false, schema: { type: "boolean" } } } }
  expect(build(contract, '{"outputs":{"main":"ok"}}').outputs).toEqual({ main: "ok" })
  expect(() => build(contract, '{"outputs":{"main":"ok","optional":"bad"}}')).toThrow(expect.objectContaining({ code: "WF_OUTPUT_INVALID" }))
})

it("test_result_semantic_condition_never_fakes_business_confirmation", () => {
  expect(() => build({ completion: "semantic" }, "I have completed everything")).toThrow(expect.objectContaining({ code: "WF_OUTPUT_UNCONFIRMED", retryable: false }))
})

it("test_result_text_bounds_and_enum_are_checked", () => {
  expect(() => build({ outputs: { text: { kind: "text", schema: { type: "string", minLength: 5 } } } }, "tiny")).toThrow(expect.objectContaining({ code: "WF_OUTPUT_INVALID" }))
  expect(() => build({ outputs: { status: { kind: "json", schema: { type: "string", enum: ["ok"] } } } }, '"no"')).toThrow(expect.objectContaining({ code: "WF_OUTPUT_INVALID" }))
})
