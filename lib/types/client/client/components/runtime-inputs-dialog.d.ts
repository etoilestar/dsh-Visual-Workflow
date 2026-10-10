import type { Dict } from "../i18n.js";
import type { RuntimeInputDialogState } from "../hooks/use-runtime-inputs.js";
import type { InputEditorKind } from "../lib/runtime-input-form.js";
interface Props {
    state: RuntimeInputDialogState;
    t: Dict;
    onCancel(): void;
    onSubmit(): void;
    onChange(patch: Partial<RuntimeInputDialogState>): void;
    onAdd(target: string, name: string, kind: InputEditorKind, value: string): void;
    onRemove(target: string, name: string): void;
    onUpload(target: string, name: string, file: File): void;
}
export declare function RuntimeInputsDialog({ state, t, onCancel, onSubmit, onChange, onAdd, onRemove, onUpload }: Props): import("react").JSX.Element;
export {};
