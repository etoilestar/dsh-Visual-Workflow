import type { Dict } from "../../../i18n.js"

export function ResponsibilityDetails({ data, copy }: { data: Record<string, unknown>; copy: Dict }) {
  const responsibility = data.responsibility && typeof data.responsibility === "object"
    ? data.responsibility as Record<string, unknown>
    : null
  const refs = Array.isArray(responsibility?.requirementRefs)
    ? responsibility.requirementRefs.map((item) => String(item).trim()).filter(Boolean)
    : []
  // validationWarnings 是调用方附加的瞬时投影，不属于 workflow node 持久化契约。
  const warnings = Array.isArray(data.validationWarnings)
    ? data.validationWarnings.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const warning = item as Record<string, unknown>
      const message = String(warning.message ?? "").trim()
      if (!message) return []
      return [{
        code: String(warning.code ?? "").trim(),
        message,
        suggestion: String(warning.suggestion ?? "").trim(),
      }]
    })
    : []
  return (
    <div className="wf-form-stack">
      <h4>{copy.responsibility}</h4>
      {String(data.inspectorNodeId ?? "").trim()
        ? <span className="wf-hint">{copy.responsibilityNodeId}: {String(data.inspectorNodeId)}</span>
        : null}
      {String(responsibility?.planningId ?? "").trim()
        ? <span className="wf-hint">{copy.responsibilityPlanningId}: {String(responsibility?.planningId)}</span>
        : null}
      <div className="wf-pathbox">
        <span className="wf-pathbox__label">{copy.responsibilityPurpose}</span>
        <span className="wf-pathbox__value">{String(responsibility?.purpose ?? "").trim() || copy.responsibilityUnset}</span>
      </div>
      <div className="wf-pathbox">
        <span className="wf-pathbox__label">{copy.responsibilityDeliverable}</span>
        <span className="wf-pathbox__value">{String(responsibility?.deliverable ?? "").trim() || copy.responsibilityUnset}</span>
      </div>
      <div className="wf-pathbox">
        <span className="wf-pathbox__label">{copy.responsibilityRequirementRefs}</span>
        <span className="wf-pathbox__value">{refs.join(" · ") || copy.responsibilityUnset}</span>
      </div>
      {String(responsibility?.id ?? "").trim()
        ? <span className="wf-hint">{copy.responsibilityId}: {String(responsibility?.id)}</span>
        : null}
      {warnings.length > 0 ? (
        <div className="wf-form-stack" role="status">
          <strong>{copy.responsibilityValidationStatus}: {copy.responsibilityWarnings}</strong>
          {warnings.map((warning, index) => (
            <span key={`${warning.code}-${index}`} className="wf-hint">
              {warning.code ? `[${warning.code}] ` : ""}{warning.message}
              {warning.suggestion ? ` ${copy.responsibilitySuggestion}: ${warning.suggestion}` : ""}
            </span>
          ))}
          {String(responsibility?.id ?? "").trim()
            ? <strong>{copy.responsibilityRepairAvailable}</strong>
            : null}
        </div>
      ) : responsibility
        ? <span className="wf-hint">{copy.responsibilityValidationStatus}: {copy.responsibilityValidationOk}</span>
        : null}
    </div>
  )
}
