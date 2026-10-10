/** Missing usage is explicitly unknown; cache/reasoning counters are not added to authoritative totals. */
export function sessionTokenAccounting(session, afterMs) {
    if (!session || typeof session !== "object")
        return { total: 0, complete: false, observed: false };
    const source = session;
    const length = typeof source.seq === "number" ? source.seq : source.events?.length;
    if (!Number.isSafeInteger(length) || Number(length) < 0)
        return { total: 0, complete: false, observed: false };
    let total = 0;
    let complete = true;
    let observed = false;
    for (let index = 0; index < Number(length); index++) {
        let raw;
        try {
            raw = source.eventAt?.(index) ?? source.events?.[index];
        }
        catch {
            complete = false;
            continue;
        }
        if (!raw || typeof raw !== "object") {
            complete = false;
            continue;
        }
        const event = raw;
        if (event.type !== "assistant/message" && event.type !== "assistant/attempt")
            continue;
        if (typeof event.time !== "number" || !Number.isFinite(event.time)) {
            complete = false;
            continue;
        }
        if (event.time < afterMs)
            continue;
        observed = true;
        const tokens = event.data?.usage?.totalTokens;
        if (!Number.isSafeInteger(tokens) || Number(tokens) < 0) {
            complete = false;
            continue;
        }
        total += Number(tokens);
        if (!Number.isSafeInteger(total))
            complete = false;
    }
    return { total, complete, observed };
}
//# sourceMappingURL=token-accounting.js.map