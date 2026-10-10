import { useState } from "react"
import type { Dict } from "../i18n.js"
import type { RuntimeInputDialogState } from "../hooks/use-runtime-inputs.js"
import type { InputEditorKind } from "../lib/runtime-input-form.js"

interface Props {
  state: RuntimeInputDialogState; t: Dict
  onCancel(): void; onSubmit(): void
  onChange(patch: Partial<RuntimeInputDialogState>): void
  onAdd(target: string, name: string, kind: InputEditorKind, value: string): void
  onRemove(target: string, name: string): void
  onUpload(target: string, name: string, file: File): void
}

export function RuntimeInputsDialog({ state, t, onCancel, onSubmit, onChange, onAdd, onRemove, onUpload }: Props) {
  const [target, setTarget] = useState("workflow")
  const [name, setName] = useState("")
  const [kind, setKind] = useState<InputEditorKind>("text")
  const [value, setValue] = useState("")
  const selected = state.runId ? `node:${state.nodeId!}` : target
  const slots = selected === "workflow" ? state.inputs.workflowInputs : state.inputs.nodeInputs[selected.slice(5)] ?? {}
  const requirements = selected === "workflow" ? state.options.workflowInputs : state.options.nodeInputs[selected.slice(5)] ?? {}
  return <div className="wf-confirm-backdrop">
    <section className="wf-confirm wf-runtime-inputs" role="dialog" aria-modal="true" aria-label={t.runtimeInputsTitle}>
      <h3>{state.runId ? t.runtimeBindTitle : t.runtimeInputsTitle}</h3>
      <p>{t.runtimeInputHelp}</p>
      <fieldset disabled={state.busy} className="wf-runtime-inputs__fields">
        <label>{t.runtimeTarget}<select value={selected} onChange={(event) => { const next = event.target.value; if (state.runId) onChange({ nodeId: next.slice(5) }); else setTarget(next); setName(""); setValue("") }}>
          {!state.runId && <option value="workflow">{t.runtimeWorkflowTarget}</option>}
          {state.eligibleNodes.map((id) => <option key={id} value={`node:${id}`}>{id}</option>)}
        </select></label>
        <p>{t.runtimeRequirements}: {Object.entries(requirements).map(([slot, requirement]) => `${slot} (${requirement.kind ?? "text"}${requirement.required === false ? "" : " *"})`).join(", ") || t.runtimeNoRequirements}</p>
        <label>{t.runtimeSlot}<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>{t.runtimeType}<select value={kind} onChange={(event) => { setKind(event.target.value as InputEditorKind); setValue("") }}>
          <option value="text">{t.runtimeText}</option><option value="json">{t.runtimeJSON}</option>
          <option value="workspace">{t.runtimeWorkspace}</option><option value="attachment">{t.runtimeAttachment}</option><option value="output">{t.runtimeOutput}</option>
        </select></label>
        <label>{t.runtimeValue}{kind === "attachment" ? <select value={value} onChange={(event) => setValue(event.target.value)}>
          <option value="">{t.runtimeChooseAttachment}</option>
          {state.options.files.map((file) => <option key={file.attachmentId} value={file.attachmentId}>{file.name} ({file.bytes})</option>)}
        </select> : <textarea value={value} placeholder={kind === "output" ? t.runtimeOutputHint : kind === "workspace" ? state.options.workingDirectory : undefined} onChange={(event) => setValue(event.target.value)} />}</label>
        <button type="button" className="wf-btn" onClick={() => { onAdd(selected, name, kind, value) }}>{t.runtimeAdd}</button>
        <label>{t.runtimeUpload}<input type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(selected, name, file); event.target.value = "" }} /></label>
        <ul>{Object.entries(slots).map(([slot, values]) => <li key={slot}><span>{slot}: {values.map((item) => item.kind).join(", ")}</span><button type="button" className="wf-btn" onClick={() => onRemove(selected, slot)}>{t.runtimeRemove}</button></li>)}</ul>
        {!state.runId && <>
          <label>{t.runtimePolicy}<select value={state.handoffPolicy} onChange={(event) => onChange({ handoffPolicy: event.target.value as RuntimeInputDialogState["handoffPolicy"] })}>
            <option value="explicit">{t.runtimeExplicit}</option><option value="auto">{t.runtimeAuto}</option><option value="strict">{t.runtimeStrict}</option>
          </select></label>
          <label>{t.runtimeParameters}<textarea value={state.parametersText} onChange={(event) => onChange({ parametersText: event.target.value })} /></label>
        </>}
      </fieldset>
      {state.error && <p role="alert" className="wf-runtime-inputs__error">{state.error}</p>}
      <div className="wf-confirm__actions"><button type="button" className="wf-btn" onClick={onCancel}>{t.runtimeCancel}</button><button type="button" className="wf-btn is-primary" disabled={state.busy} onClick={onSubmit}>{state.busy ? t.runtimeWorking : state.runId ? t.runtimeBind : t.run}</button></div>
    </section>
  </div>
}
