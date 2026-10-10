export interface TokenAccounting {
    total: number;
    complete: boolean;
    observed: boolean;
}
/** Missing usage is explicitly unknown; cache/reasoning counters are not added to authoritative totals. */
export declare function sessionTokenAccounting(session: unknown, afterMs: number): TokenAccounting;
