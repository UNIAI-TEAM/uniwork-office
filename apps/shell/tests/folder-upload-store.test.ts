import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachFolderUploadStore,
  folderUploadRuns,
  onFolderUploadSettled,
  patchFolderUploadRun,
  removeFolderUploadRun,
  resetFolderUploadStore,
  startFolderUploadRun,
  subscribeFolderUploadStore,
  type StoredFolderUploadRun,
} from '../src/renderer/src/uniwork-folder-upload/folder-upload-store'
import { createFakeFolderUploadBridge, progressOf } from './folder-upload-fake-bridge'

/**
 * UNI-2052 Q6: the runs and their reports live in a module-level store, so a
 * screen that unmounts and mounts again still shows the run, and the progress
 * main pushes while no screen is mounted is not lost.
 */

const run = (over: Partial<StoredFolderUploadRun> = {}): StoredFolderUploadRun => ({
  runId: 'run-1',
  mode: 'folder',
  name: 'Case',
  targetLabel: 'My Folder',
  phase: 'planning',
  done: 0,
  failed: 0,
  total: 40,
  failures: [],
  ...over,
})

beforeEach(() => resetFolderUploadStore())

describe('the folder-upload run store', () => {
  it('listens to progress once per bridge and keeps listening with no subscriber', () => {
    const bridge = createFakeFolderUploadBridge()
    attachFolderUploadStore(bridge)
    attachFolderUploadStore(bridge)
    expect(bridge.listeners).toBe(1)
    startFolderUploadRun(bridge, run())
    bridge.emit(progressOf({ done: 9 }))
    expect(folderUploadRuns(bridge)[0]).toMatchObject({ phase: 'uploading', done: 9 })
  })

  it('applies the real title, folder id and failures of a progress event', () => {
    const bridge = createFakeFolderUploadBridge()
    attachFolderUploadStore(bridge)
    startFolderUploadRun(bridge, run())
    bridge.emit(
      progressOf({
        phase: 'done',
        done: 39,
        failed: 1,
        rootTitle: 'Case (1)',
        rootFolderId: 'f9',
        failures: [{ path: 'a.docx', code: 'network', retryable: true }],
      }),
    )
    expect(folderUploadRuns(bridge)[0]).toMatchObject({
      name: 'Case (1)',
      rootFolderId: 'f9',
      failures: [{ path: 'a.docx', code: 'network', retryable: true }],
    })
  })

  it('files mode keeps the destination name whatever the event says', () => {
    const bridge = createFakeFolderUploadBridge()
    attachFolderUploadStore(bridge)
    startFolderUploadRun(bridge, run({ mode: 'files', name: 'My Folder' }))
    bridge.emit(progressOf({ rootTitle: 'Other' }))
    expect(folderUploadRuns(bridge)[0]!.name).toBe('My Folder')
  })

  it('keeps the newest early event of a run until the start call names it (at most 8 runs)', () => {
    const bridge = createFakeFolderUploadBridge()
    attachFolderUploadStore(bridge)
    bridge.emit(progressOf({ runId: 'r-early', done: 1 }))
    bridge.emit(progressOf({ runId: 'r-early', done: 4 }))
    startFolderUploadRun(bridge, run({ runId: 'r-early' }))
    expect(folderUploadRuns(bridge)[0]).toMatchObject({ done: 4 })
    for (let i = 0; i < 12; i++) bridge.emit(progressOf({ runId: `o${i}`, done: i }))
    startFolderUploadRun(bridge, run({ runId: 'o0' }))
    expect(folderUploadRuns(bridge).find((r) => r.runId === 'o0')).toMatchObject({
      phase: 'planning',
      done: 0,
    })
    startFolderUploadRun(bridge, run({ runId: 'o11' }))
    expect(folderUploadRuns(bridge).find((r) => r.runId === 'o11')).toMatchObject({ done: 11 })
  })

  it('ignores progress of a run it does not hold', () => {
    const bridge = createFakeFolderUploadBridge()
    attachFolderUploadStore(bridge)
    startFolderUploadRun(bridge, run())
    bridge.emit(progressOf({ runId: 'someone-else', phase: 'done' }))
    expect(folderUploadRuns(bridge)).toHaveLength(1)
    expect(folderUploadRuns(bridge)[0]!.phase).toBe('planning')
  })

  it('tells settle listeners once per settling, not on every later event', () => {
    const bridge = createFakeFolderUploadBridge()
    attachFolderUploadStore(bridge)
    startFolderUploadRun(bridge, run())
    const settled = vi.fn()
    const off = onFolderUploadSettled(settled)
    bridge.emit(progressOf({ phase: 'uploading' }))
    expect(settled).not.toHaveBeenCalled()
    bridge.emit(progressOf({ phase: 'done', done: 40 }))
    bridge.emit(progressOf({ phase: 'done', done: 40 }))
    expect(settled).toHaveBeenCalledTimes(1)
    off()
  })

  it('patch and remove change the list and tell subscribers', () => {
    const bridge = createFakeFolderUploadBridge()
    attachFolderUploadStore(bridge)
    const changed = vi.fn()
    const off = subscribeFolderUploadStore(changed)
    startFolderUploadRun(bridge, run())
    patchFolderUploadRun('run-1', { phase: 'uploading', failures: [] })
    expect(folderUploadRuns(bridge)[0]!.phase).toBe('uploading')
    removeFolderUploadRun('run-1')
    expect(folderUploadRuns(bridge)).toEqual([])
    expect(changed).toHaveBeenCalledTimes(3)
    off()
    removeFolderUploadRun('run-1')
    expect(changed).toHaveBeenCalledTimes(3)
  })

  it('hands the same array back while nothing changed (a stable snapshot for React)', () => {
    const bridge = createFakeFolderUploadBridge()
    attachFolderUploadStore(bridge)
    startFolderUploadRun(bridge, run())
    expect(folderUploadRuns(bridge)).toBe(folderUploadRuns(bridge))
    expect(folderUploadRuns(null)).toBe(folderUploadRuns(null))
  })

  it('a different bridge starts clean and the old one is let go', () => {
    const first = createFakeFolderUploadBridge()
    const second = createFakeFolderUploadBridge()
    attachFolderUploadStore(first)
    startFolderUploadRun(first, run())
    attachFolderUploadStore(second)
    expect(first.listeners).toBe(0)
    expect(second.listeners).toBe(1)
    expect(folderUploadRuns(first)).toEqual([])
    expect(folderUploadRuns(second)).toEqual([])
  })
})
