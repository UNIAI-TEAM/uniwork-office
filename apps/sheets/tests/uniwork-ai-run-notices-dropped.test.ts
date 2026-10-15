// The Sheets run folds the notices into the message text, so the structured dropped calls the result
// chip needs (G6-05u F3) are read back from the same surface: dropped calls of the run, in order,
// emptied with the next run.
import { describe, expect, it } from 'vitest'
import type { NoticeKey } from '@genoffice/agent-core'
import { createRunNotices } from '../src/renderer/ai/run-notices'

const tr = (key: NoticeKey) => key

describe('run notices: dropped calls for the result chip', () => {
  it('collects view-only and not-allowlisted calls with the module, and clear() empties them', () => {
    const notices = createRunNotices()
    expect(notices.droppedCalls()).toEqual([])
    notices.notice(
      { kind: 'dropped-tool-calls', calls: [{ index: 0, name: 'edit', reason: 'view_only' }] },
      tr,
      'Sheets',
    )
    notices.notice(
      { kind: 'dropped-tool-calls', calls: [{ index: 1, name: 'x', reason: 'not_allowlisted' }] },
      tr,
      'Sheets',
    )
    expect(notices.droppedCalls()).toEqual([
      { name: 'edit', reason: 'view_only', module: 'Sheets' },
      { name: 'x', reason: 'not_allowlisted', module: 'Sheets' },
    ])
    notices.clear()
    expect(notices.droppedCalls()).toEqual([])
  })

  it('other notices are not dropped calls', () => {
    const notices = createRunNotices()
    notices.notice({ kind: 'conversation-restarted' }, tr, 'Sheets')
    expect(notices.droppedCalls()).toEqual([])
  })
})
