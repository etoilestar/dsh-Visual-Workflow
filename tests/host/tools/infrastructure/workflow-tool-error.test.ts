import { expect, it } from "vitest"
import { workflowToolError } from "../../../../src/host/tools/infrastructure/workflow-tool-error.js"

it("test_workflow_tool_error_keeps_stable_code_and_field_diagnostics_in_model_message", () => {
  const error = Object.assign(new Error("input missing"), { code: "WF_BAD_ARGS", details: [{ field: "nodeId", message: "required" }] })
  expect(() => workflowToolError(error)).toThrow('WF_BAD_ARGS: input missing; fields=[{"field":"nodeId","message":"required"}]')
  expect(error.code).toBe("WF_BAD_ARGS")
})

it("test_workflow_tool_error_preserves_foreign_transport_failures", () => {
  const error = new Error("DSH transport error")
  expect(() => workflowToolError(error)).toThrow(error)
  expect(error.message).toBe("DSH transport error")
})
