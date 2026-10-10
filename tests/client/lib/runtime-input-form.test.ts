import { expect, it } from "vitest"
import { formInputValue, missingWorkflowInputs, validInputSlot } from "../../../src/client/lib/runtime-input-form.js"

it("test_input_form_preserves_each_typed_source", () => {
  expect(formInputValue("text", "text", [])).toEqual({ kind: "text", value: "text" })
  expect(formInputValue("json", '{"n":1}', [])).toEqual({ kind: "json", value: { n: 1 } })
  expect(formInputValue("workspace", "data.csv", [])).toEqual({ kind: "file", fileRef: { source: "workspace", path: "data.csv" } })
  expect(formInputValue("output", '{"nodeId":"upstream","output":"data","attempt":2}', [])).toEqual({ kind: "output", nodeId: "upstream", output: "data", attempt: 2, runId: undefined })
  expect(formInputValue("attachment", "id", [{ attachmentId: "id", name: "data", bytes: 1, path: "/host" }])).toEqual({ kind: "file", fileRef: { source: "attachment", attachmentId: "id", name: "data", bytes: 1 } })
})
it("test_input_form_invalid_refs_and_slots_are_rejected", () => {
  expect(() => formInputValue("attachment", "unknown", [])).toThrow("attachmentId")
  expect(() => formInputValue("output", "{}", [])).toThrow("nodeId")
  expect(() => formInputValue("json", "broken", [])).toThrow()
  for (const name of ["", " ", "__proto__", "constructor", "prototype", "a".repeat(129)]) expect(validInputSlot(name)).toBe(false)
  expect(validInputSlot("source")).toBe(true)
})
it("test_required_inputs_ignore_optional_and_nonempty_bound_values", () => {
  expect(missingWorkflowInputs({ workflowInputs: { first: [{ kind: "text", value: "v" }] }, nodeInputs: {} }, { workflowInputs: { first: {}, missing: {}, optional: { required: false } }, nodeInputs: {}, files: [], handoffPolicy: "explicit" })).toEqual(["missing"])
})
