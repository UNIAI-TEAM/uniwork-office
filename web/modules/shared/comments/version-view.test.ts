/**
 * UNI-2033 (T4): the bridge half of "view the version an anchor was kept in". The kit gets
 * `onViewVersion` only with the effective `commentsViewVersion` capability, and `openVersionId`
 * is the `FileMeta.versionId` the host gave in `api.open` (or the one a landed save made current).
 */
import { describe, expect, it } from 'vitest'
import { createMockPort } from '../../../docs/bridge/testing/mock-port'
import { frameCommentsClaim } from '../discussion/claim'
import {
  createFrameCommentsApi,
  createFrameDocVersion,
  createFrameViewVersion,
  frameOpenVersionId,
  frameVersionViewProps,
} from './index'

const COMMENT_ID = '01J8X4CMTN0000000000000001'

function framePort(capabilities: Record<string, boolean>) {
  const mock = createMockPort({
    documentId: 'doc-1',
    capabilities: { save: true, ...capabilities },
    commentsLevel: 'edit',
  } as never)
  return mock
}

describe('createFrameViewVersion', () => {
  it('with the grant: forwards {commentId, versionNo} as comments.viewVersion and returns {opened}', async () => {
    const mock = framePort({ comments: true, commentsViewVersion: true })
    mock.override('comments.viewVersion', () => ({ opened: true }))
    const session = await mock.port.whenInitialized()
    const onViewVersion = createFrameViewVersion(mock.port, session)
    expect(onViewVersion).toBeTypeOf('function')
    await expect(onViewVersion!({ commentId: COMMENT_ID, versionNo: 3 })).resolves.toEqual({
      opened: true,
    })
    expect(
      mock.calls.filter((c) => c.type === 'comments.viewVersion').map((c) => c.payload),
    ).toEqual([{ comment_id: COMMENT_ID, version_no: 3 }])
  })

  it('a host answer {opened: false} reaches the kit unchanged', async () => {
    const mock = framePort({ comments: true, commentsViewVersion: true })
    mock.override('comments.viewVersion', () => ({ opened: false }))
    const onViewVersion = createFrameViewVersion(mock.port, await mock.port.whenInitialized())
    await expect(onViewVersion!({ commentId: COMMENT_ID, versionNo: 2 })).resolves.toEqual({
      opened: false,
    })
  })

  it('a protocol failure becomes {opened: false}: the kit shows its own "unavailable" line', async () => {
    const mock = framePort({ comments: true, commentsViewVersion: true })
    mock.override('comments.viewVersion', () => {
      throw new Error('boom')
    })
    const onViewVersion = createFrameViewVersion(mock.port, await mock.port.whenInitialized())
    await expect(onViewVersion!({ commentId: COMMENT_ID, versionNo: 2 })).resolves.toEqual({
      opened: false,
    })
  })

  it('without the grant, without comments, or with an invalid version: undefined, nothing sent', async () => {
    for (const caps of [
      { comments: true },
      { commentsViewVersion: true },
      { comments: false, commentsViewVersion: true },
      {},
    ]) {
      const mock = framePort(caps)
      const session = await mock.port.whenInitialized()
      expect(createFrameViewVersion(mock.port, session)).toBeUndefined()
      expect(mock.calls.filter((c) => c.type === 'comments.viewVersion')).toEqual([])
    }
  })

  it('the frame claims commentsViewVersion with comments, so the host grant can become effective', () => {
    expect(frameCommentsClaim(true)).toEqual({
      comments: true,
      commentsShareView: true,
      commentsViewVersion: true,
    })
    expect(frameCommentsClaim(false)).toEqual({})
  })
})

describe('frameOpenVersionId', () => {
  it('is the versionId the host gave in api.open, then the one a landed save made current', () => {
    const version = createFrameDocVersion()
    const session = { documentId: 'doc-1' }
    expect(frameOpenVersionId(version, session)).toBeUndefined()
    version.noteOpened({ path: 'p', versionId: 'ver-1' })
    expect(frameOpenVersionId(version, session)).toBe('ver-1')
    version.noteSaved({ path: 'p', versionId: 'ver-2' })
    expect(frameOpenVersionId(version, session)).toBe('ver-2')
  })

  it('falls back to the file of init.open before the bridge noted anything', () => {
    const version = createFrameDocVersion()
    const session = {
      documentId: 'doc-1',
      open: {
        file: { fileId: 'f1', name: 'a.docx', versionId: 'ver-init', etag: '"e"', sizeBytes: 1 },
        source: { kind: 'bytes' as const, data: new ArrayBuffer(0) },
      },
    }
    expect(frameOpenVersionId(version, session)).toBe('ver-init')
  })
})

describe('frameVersionViewProps', () => {
  it('gives the kit both props with the grant and only openVersionId without it', async () => {
    const version = createFrameDocVersion()
    version.noteOpened({ path: 'p', versionId: 'ver-9' })

    const granted = framePort({ comments: true, commentsViewVersion: true })
    const withGrant = frameVersionViewProps(granted.port, await granted.port.whenInitialized(), version)
    expect(withGrant.openVersionId).toBe('ver-9')
    expect(withGrant.onViewVersion).toBeTypeOf('function')

    const plain = framePort({ comments: true })
    const without = frameVersionViewProps(plain.port, await plain.port.whenInitialized(), version)
    expect(without.openVersionId).toBe('ver-9')
    expect(without.onViewVersion).toBeUndefined()
    expect('onViewVersion' in without).toBe(false)
  })
})

describe('window.uniworkComments extras', () => {
  it('viewVersion exists only with the effective grant and openVersionId follows the open file', async () => {
    const version = createFrameDocVersion()
    version.noteOpened({ path: 'p', versionId: 'ver-5' })

    const granted = framePort({ comments: true, commentsViewVersion: true })
    granted.override('comments.viewVersion', () => ({ opened: true }))
    const api = createFrameCommentsApi(granted.port, {
      version,
      session: await granted.port.whenInitialized(),
    })
    expect(api.openVersionId?.()).toBe('ver-5')
    await expect(api.viewVersion!({ commentId: COMMENT_ID, versionNo: 4 })).resolves.toEqual({
      opened: true,
    })

    const plain = framePort({ comments: true })
    const bare = createFrameCommentsApi(plain.port, {
      version,
      session: await plain.port.whenInitialized(),
    })
    expect(bare.viewVersion).toBeUndefined()
    expect(bare.openVersionId?.()).toBe('ver-5')
  })
})
