// The mock host answers the G8-08 comments requests like a host without the `comments` capability.
import { describe, expect, it } from 'vitest'
import { createMockPort } from './testing/mock-port'

describe('mock port comments handlers', () => {
  it('answers comments.list and mentions.search unsupported by default', async () => {
    const mock = createMockPort()
    await expect(mock.port.request('comments.list', {})).rejects.toMatchObject({
      code: 'unsupported',
    })
    await expect(mock.port.request('mentions.search', { q: 'a' })).rejects.toMatchObject({
      code: 'unsupported',
    })
  })

  it('lets a test replace a comments request with override()', async () => {
    const mock = createMockPort()
    const list = { comments: [], mentions: [], list_token: 't1', unchanged: false }
    mock.override('comments.list', () => list)
    await expect(mock.port.request('comments.list', {})).resolves.toEqual(list)
  })
})
