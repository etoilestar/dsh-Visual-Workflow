import type { HandoffPolicy, RuntimeInputs, RuntimeInputOptions } from "../../host/shared/runtime-types.js";
import type { Dict } from "../i18n.js";
import type { RemoteFace } from "./useRemote.js";
import { type InputEditorKind } from "../lib/runtime-input-form.js";
export interface RuntimeInputSelection {
    runtimeInputs: RuntimeInputs;
    handoffPolicy: HandoffPolicy;
    requestGeneration?: number;
}
export interface RuntimeInputLifecycle {
    capture(): number;
    isCurrent(ticket: number): boolean;
}
export type PrepareRuntimeInputs = (sessionId: string, flowId: string, runId?: string, binding?: boolean) => Promise<RuntimeInputSelection | null>;
export interface RuntimeInputDialogState {
    sessionId: string;
    flowId: string;
    options: RuntimeInputOptions;
    inputs: RuntimeInputs;
    handoffPolicy: HandoffPolicy;
    parametersText: string;
    nodeId?: string;
    runId?: string;
    revision?: number;
    eligibleNodes: string[];
    error: string;
    busy: boolean;
}
export declare function useRuntimeInputs(remote: RemoteFace, t: Dict, owner: string): {
    dialog: RuntimeInputDialogState | null;
    prepare: PrepareRuntimeInputs;
    lifecycle: RuntimeInputLifecycle;
    cancel: () => void;
    change: (patch: Partial<RuntimeInputDialogState>) => void;
    add: (target: string, name: string, kind: InputEditorKind, value: string) => void;
    remove: (target: string, name: string) => void;
    upload: (target: string, name: string, file: File) => Promise<void>;
    submit: () => Promise<void>;
};
