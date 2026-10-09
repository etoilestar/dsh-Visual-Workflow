import { isRecord } from "./variables.js";
const secretValueFields = new Set(["authorization", "api_key", "apikey", "access_token", "refresh_token", "password", "secret", "cookie"]);
const credentialReferenceFields = new Set(["credential_id", "credential_name"]);
export function sanitizeSourceValue(input) {
    let containedSecret = false;
    let requiresCredentialRebinding = false;
    const visit = (value) => {
        if (Array.isArray(value))
            return value.map(visit);
        if (!isRecord(value))
            return value;
        const output = {};
        for (const [key, nested] of Object.entries(value)) {
            const normalizedKey = key.toLowerCase().replaceAll("-", "_");
            if (secretValueFields.has(normalizedKey)) {
                containedSecret = true;
                requiresCredentialRebinding = true;
                continue;
            }
            if (credentialReferenceFields.has(normalizedKey)) {
                requiresCredentialRebinding = true;
                continue;
            }
            output[key] = visit(nested);
        }
        return output;
    };
    return { value: visit(input), containedSecret, requiresCredentialRebinding };
}
//# sourceMappingURL=sanitize.js.map