export interface SanitizedValue {
    value: unknown;
    containedSecret: boolean;
    requiresCredentialRebinding: boolean;
}
export declare function sanitizeSourceValue(input: unknown): SanitizedValue;
