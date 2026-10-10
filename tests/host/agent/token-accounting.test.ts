import { expect, it } from "vitest"
import { sessionTokenAccounting } from "../../../src/host/agent/token-accounting.js"

it("test_tokens_authoritative_total_excludes_history_and_does_not_double_count_cache", () => {
  const events = [
    { type: "assistant/message", time: 1, data: { usage: { totalTokens: 900 } } },
    { type: "assistant/message", time: 10, data: { usage: { totalTokens: 12, cacheReadTokens: 10, reasoningTokens: 5 } } },
    { type: "assistant/message", time: 20, data: { usage: { totalTokens: 8 } } },
  ]
  expect(sessionTokenAccounting({ seq: 3, eventAt: (index: number) => events[index] }, 10)).toEqual({ total: 20, complete: true, observed: true })
})

it.each([{}, { inputTokens: 10, outputTokens: 20 }, { totalTokens: NaN }, { totalTokens: -1 }])("test_tokens_missing_or_invalid_usage_never_estimates_%s", (usage) => {
  expect(sessionTokenAccounting({ events: [{ type: "assistant/message", time: 10, data: { usage } }] }, 10)).toEqual({ total: 0, complete: false, observed: true })
})

it("test_tokens_missing_session_failed_attempt_or_unreadable_log_is_incomplete", () => {
  expect(sessionTokenAccounting(undefined, 10).complete).toBe(false)
  expect(sessionTokenAccounting({ events: [{ type: "assistant/attempt", time: 10 }] }, 10).complete).toBe(false)
  expect(sessionTokenAccounting({ seq: 1, eventAt: () => { throw new Error("unreadable") } }, 10).complete).toBe(false)
})

it("test_tokens_empty_session_is_pending_without_fake_usage", () => {
  expect(sessionTokenAccounting({ events: [] }, 10)).toEqual({ total: 0, complete: true, observed: false })
})
