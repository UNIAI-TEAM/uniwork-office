import { describe, expect, it } from 'vitest'
import { asPreflightSDO } from '../src/preload/folder-upload-guards'

const base = {
  preflightId: 'p1',
  mode: 'files',
  totals: { files: 2, bytes: 10 },
  skipped: [],
  refusal: null,
  shareAvailable: true,
  parentShared: false,
}

describe('asPreflightSDO target', () => {
  it('keeps the My Folder marker main set (FU-V2)', () => {
    const sdo = asPreflightSDO({
      ...base,
      target: { workspaceId: 'w', folderId: 'my1', label: 'my-folder-raw', myFolder: true },
    })
    expect(sdo?.target).toEqual({
      workspaceId: 'w',
      folderId: 'my1',
      label: 'my-folder-raw',
      myFolder: true,
    })
  })

  it('leaves the marker off for a plain folder or an odd value', () => {
    for (const myFolder of [undefined, false, 'yes']) {
      const sdo = asPreflightSDO({
        ...base,
        target: { workspaceId: 'w', folderId: 'f1', label: 'Contracts', myFolder },
      })
      expect(sdo?.target).toEqual({ workspaceId: 'w', folderId: 'f1', label: 'Contracts' })
    }
  })
})
