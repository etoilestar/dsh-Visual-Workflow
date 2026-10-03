import type { Dict } from "../../../i18n.js"

export function ResponsibilityDetails({ data, copy }: { data: Record<string, unknown>; copy: Dict }) {
  const responsibility = data.responsibility && typeof data.responsibility === "object"
    ? data.responsibility as Record<string, unknown>
    : null
  const refs = Array.isArray(responsibility?.requirementRefs)
    ? responsibility.requirementRefs.map((item) => String(item).trim()).filter(Boolean)
    : []
  return (
    <div className="wf-form-stack">
      <h4>{copy.responsibility}</h4>
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
    </div>
  )
}
