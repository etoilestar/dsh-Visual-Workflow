import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { RunHistory } from '../../../../src/client/components/run-history/RunHistory.js'
import { zh, en } from '../../../../src/client/i18n.js'
import type { RunSnapshot } from '../../../../src/host/shared/types.js'

it('history projects failure code, actual route and prior failed attempts while accepting legacy snapshots', () => {
  const failure = { phase: 'child_start' as const, code: 'WF_CHILD_START_FAILED', message: 'scope initialization failed', retryable: false, occurredAt: '2026-10-09T00:00:00Z' }
  const run: RunSnapshot = {
    id: 'run-visible', flowId: 'flow', flowName: '销售', sessionId: 'session', mode: 'mode1', status: 'failed', startedAt: failure.occurredAt, endedAt: failure.occurredAt, summary: '失败',
    termination: { source: 'parent_error', stopReason: 'error', failure },
    nodes: [{ nodeId: 'load_data', status: 'fail', attempts: 2, startedAt: failure.occurredAt, endedAt: failure.occurredAt, output: '', outputSummary: '', failure,
      attemptHistory: [{ attempt: 1, phase: 'settled', status: 'fail', startedAt: failure.occurredAt, childId: 'child-evidence', provider: 'actual-provider', model: 'actual-model', failure }] }],
  }
  const render = (history: RunSnapshot[], copy = zh) => renderToStaticMarkup(<RunHistory history={history} selectedRunId={null} copy={copy} onSelect={() => {}} onClose={() => {}} onResume={() => {}} canResume={false} />)
  for (const copy of [zh, en]) {
    const html = render([run], copy)
    for (const value of ['WF_CHILD_START_FAILED', 'scope initialization failed', 'child-evidence', 'actual-provider/actual-model', 'parent_error']) expect(html).toContain(value)
  }
  const legacy = structuredClone(run)
  delete legacy.termination
  delete legacy.nodes[0].failure
  delete legacy.nodes[0].attemptHistory
  expect(render([legacy])).toContain('load_data')
})
