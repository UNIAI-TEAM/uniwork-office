import { accessSync, constants, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DRAFT_PREVIEW_DIR } from '@genoffice/electron-utils/draft-preview'
import {
  createLastSessionFilterDeps,
  createSessionSnapshotRecorder,
  filterLastSessionDocuments,
  launchPathsWithLastSession,
  openLaunchSequence,
  readLastSessionDocuments,
} from '../src/main/last-session'
import { SourceViewRegistry } from '../src/main/uniwork-docs/source-view'

vi.mock('node:fs', async (importOriginal) => {
  const actual: typeof import('node:fs') = await importOriginal()
  return {
    ...actual,
    accessSync: vi.fn(actual.accessSync),
  }
})

const all = () => true

describe('readLastSessionDocuments', () => {
  it('keeps absolute string paths once, in order', () => {
    expect(
      readLastSessionDocuments({
        lastSessionDocuments: ['/a.docx', 'relative.docx', 7, null, '/b.xlsx', '/a.docx'],
      }),
    ).toEqual(['/a.docx', '/b.xlsx'])
  })

  it('treats a missing or malformed value as no documents', () => {
    expect(readLastSessionDocuments({})).toEqual([])
    expect(readLastSessionDocuments({ lastSessionDocuments: '/a.docx' })).toEqual([])
  })

  it('caps a hand-edited list', () => {
    const many = Array.from({ length: 500 }, (_, i) => `/doc-${i}.md`)
    expect(readLastSessionDocuments({ lastSessionDocuments: many })).toHaveLength(50)
  })

  it('skips paths inside the UniWork store and under unreachable folder roots', () => {
    const list = [
      '/local/a.docx',
      '/uniwork-store/doc-1/working.docx',
      '/unplugged-drive/b.xlsx',
      '/local/c.pptx',
    ]
    const deps = {
      inUniworkStore: (p: string) => p.startsWith('/uniwork-store/'),
      inUnreachableRoot: (p: string) => p.startsWith('/unplugged-drive/'),
    }
    expect(filterLastSessionDocuments(list, deps)).toEqual(['/local/a.docx', '/local/c.pptx'])
    expect(readLastSessionDocuments({ lastSessionDocuments: list }, deps)).toEqual([
      '/local/a.docx',
      '/local/c.pptx',
    ])
  })
})

describe('launchPathsWithLastSession', () => {
  const saved = { lastSessionDocuments: ['/a.docx', '/gone.pptx', '/b.xlsx'] }

  it('opens only the launch paths while the setting is off', () => {
    expect(launchPathsWithLastSession(saved, ['/c.pdf'], all)).toEqual(['/c.pdf'])
  })

  it('restores existing documents first, then the launch paths, without duplicates', () => {
    const settings = { ...saved, restoreLastSession: true }
    const exists = (p: string) => p !== '/gone.pptx'
    expect(launchPathsWithLastSession(settings, ['/b.xlsx', '/c.pdf'], exists)).toEqual([
      '/a.docx',
      '/b.xlsx',
      '/c.pdf',
    ])
  })

  it('drops stored paths that fall inside the UniWork store or an unreachable root at launch', () => {
    const settings = {
      restoreLastSession: true,
      lastSessionDocuments: [
        '/uniwork-store/bound.docx',
        '/revoked-root/secret.xlsx',
        '/local/keep.docx',
      ],
    }
    const deps = {
      inUniworkStore: (p: string) => p.startsWith('/uniwork-store/'),
      inUnreachableRoot: (p: string) => p.startsWith('/revoked-root/'),
    }
    expect(launchPathsWithLastSession(settings, ['/local/arg.pdf'], all, deps)).toEqual([
      '/local/keep.docx',
      '/local/arg.pdf',
    ])
  })

  it('excludes an existing file under the draft-preview root when the source-view registry is empty and drops files under an R_OK-denied extra root', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'last-session-real-'))
    try {
      const userDataDir = join(tmp, 'userData')
      const previewDir = join(userDataDir, DRAFT_PREVIEW_DIR, 'src-1')
      mkdirSync(previewDir, { recursive: true })
      const previewFile = join(previewDir, 'preview.docx')
      writeFileSync(previewFile, 'draft preview')

      const deniedRoot = join(tmp, 'revoked-root')
      mkdirSync(deniedRoot, { recursive: true })
      const deniedFile = join(deniedRoot, 'secret.xlsx')
      writeFileSync(deniedFile, 'secret')

      const allowedDir = join(tmp, 'local')
      mkdirSync(allowedDir, { recursive: true })
      const allowedFile = join(allowedDir, 'keep.docx')
      writeFileSync(allowedFile, 'keep')

      const emptyRegistry = new SourceViewRegistry()
      vi.mocked(accessSync).mockImplementation((p, mode) => {
        if (p === deniedRoot && mode === constants.R_OK) {
          throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
        }
      })

      const deps = createLastSessionFilterDeps({
        userDataDir,
        extraRoots: [deniedRoot, allowedDir],
        inStore: () => false,
        inSourceViews: (p) => emptyRegistry.has(p),
      })

      expect(filterLastSessionDocuments([previewFile, deniedFile, allowedFile], deps)).toEqual([
        allowedFile,
      ])
      expect(
        launchPathsWithLastSession(
          {
            restoreLastSession: true,
            lastSessionDocuments: [previewFile, deniedFile, allowedFile],
          },
          [],
          undefined,
          deps,
        ),
      ).toEqual([allowedFile])
    } finally {
      vi.mocked(accessSync).mockRestore()
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('openLaunchSequence', () => {
  it('opens the Home tab when there are no targets and no launch URL', async () => {
    const events: string[] = []
    await openLaunchSequence({
      targets: [],
      launchUrl: null,
      openPath: (p) => {
        events.push(`path:${p}`)
        return true
      },
      openUrl: async (u) => {
        events.push(`url:${u}`)
        return true
      },
      openHomeTab: () => events.push('home'),
    })
    expect(events).toEqual(['home'])
  })

  it('opens only the URL when there are no targets and the launch URL succeeds', async () => {
    const events: string[] = []
    await openLaunchSequence({
      targets: [],
      launchUrl: 'uniwork-office://open?doc=1',
      openPath: (p) => {
        events.push(`path:${p}`)
        return true
      },
      openUrl: async (u) => {
        events.push(`url:${u}`)
        return true
      },
      openHomeTab: () => events.push('home'),
    })
    expect(events).toEqual(['url:uniwork-office://open?doc=1'])
  })

  it('falls back to the Home tab when there are no targets and the launch URL fails', async () => {
    const events: string[] = []
    await openLaunchSequence({
      targets: [],
      launchUrl: 'uniwork-office://open?doc=bad',
      openPath: (p) => {
        events.push(`path:${p}`)
        return true
      },
      openUrl: async (u) => {
        events.push(`url:${u}`)
        return false
      },
      openHomeTab: () => events.push('home'),
    })
    expect(events).toEqual(['url:uniwork-office://open?doc=bad', 'home'])
  })

  it('opens restored targets first and the launch URL last when both exist and the URL succeeds', async () => {
    const events: string[] = []
    await openLaunchSequence({
      targets: ['/a.docx', '/b.xlsx'],
      launchUrl: 'uniwork-office://open?doc=1',
      openPath: (p) => {
        events.push(`path:${p}`)
        return true
      },
      openUrl: async (u) => {
        events.push(`url:${u}`)
        return true
      },
      openHomeTab: () => events.push('home'),
    })
    expect(events).toEqual(['path:/a.docx', 'path:/b.xlsx', 'url:uniwork-office://open?doc=1'])
  })

  it('opens restored targets only once and skips the Home tab when the launch URL fails', async () => {
    const events: string[] = []
    await openLaunchSequence({
      targets: ['/a.docx', '/b.xlsx'],
      launchUrl: 'uniwork-office://open?doc=bad',
      openPath: (p) => {
        events.push(`path:${p}`)
        return true
      },
      openUrl: async (u) => {
        events.push(`url:${u}`)
        return false
      },
      openHomeTab: () => events.push('home'),
    })
    expect(events).toEqual(['path:/a.docx', 'path:/b.xlsx', 'url:uniwork-office://open?doc=bad'])
  })

  it('opens the Home tab when all targets and the launch URL fail to open', async () => {
    const events: string[] = []
    await openLaunchSequence({
      targets: ['/missing.docx'],
      launchUrl: 'uniwork-office://open?doc=bad',
      openPath: (p) => {
        events.push(`path:${p}`)
        return false
      },
      openUrl: async (u) => {
        events.push(`url:${u}`)
        return false
      },
      openHomeTab: () => events.push('home'),
    })
    expect(events).toEqual(['path:/missing.docx', 'url:uniwork-office://open?doc=bad', 'home'])
  })
})

describe('createSessionSnapshotRecorder', () => {
  it('writes shell paths on a shell-only quit and prevents the subsequent shell closed event from overwriting with a smaller list', () => {
    const writes: string[][] = []
    const shellOpen = ['/shell/a.docx', '/shell/b.xlsx']
    const detachedOpen: string[] = []
    const recorder = createSessionSnapshotRecorder({
      enabled: () => true,
      filterDeps: () => ({}),
      write: (paths) => writes.push(paths),
    })

    recorder.onBeforeQuit(shellOpen, detachedOpen)
    recorder.onShellClosed(['/shell/a.docx', '/shell/b.xlsx'], detachedOpen)

    expect(writes).toEqual([['/shell/a.docx', '/shell/b.xlsx']])
  })

  it('reflects a later detached Save As at quit when the shell window closed first', () => {
    const writes: string[][] = []
    let shellOpen: string[] | null = ['/shell/a.docx']
    let detachedOpen: string[] = ['/detached/initial.pptx']
    const recorder = createSessionSnapshotRecorder({
      enabled: () => true,
      filterDeps: () => ({}),
      write: (paths) => writes.push(paths),
    })

    // Shell closes first while detached remains open
    const dropped = shellOpen
    shellOpen = null
    recorder.onShellClosed(dropped, detachedOpen)
    expect(writes).toEqual([['/shell/a.docx', '/detached/initial.pptx']])

    // Detached editor performs Save As and then the app quits
    detachedOpen = ['/detached/saved-as.pptx']
    recorder.onBeforeQuit(shellOpen, detachedOpen)
    expect(writes).toEqual([
      ['/shell/a.docx', '/detached/initial.pptx'],
      ['/shell/a.docx', '/detached/saved-as.pptx'],
    ])
  })

  it('preserves both shell and detached paths during a multi-window quit when detached windows close before the shell window', () => {
    const writes: string[][] = []
    const shellOpen = ['/shell/a.docx']
    let detachedOpen: string[] = ['/detached/d.xlsx']
    const recorder = createSessionSnapshotRecorder({
      enabled: () => true,
      filterDeps: () => ({}),
      write: (paths) => writes.push(paths),
    })

    // Quit starts while both shell and detached are alive
    recorder.onBeforeQuit(shellOpen, detachedOpen)
    // Detached window closes first, emptying detachedOpen before shell 'closed' fires
    detachedOpen = []
    recorder.onShellClosed(shellOpen, detachedOpen)

    expect(writes).toEqual([['/shell/a.docx', '/detached/d.xlsx']])
  })

  it('allows the next shell close or quit to rewrite the snapshot after a vetoed quit', () => {
    const writes: string[][] = []
    const recorder = createSessionSnapshotRecorder({
      enabled: () => true,
      filterDeps: () => ({}),
      write: (paths) => writes.push(paths),
    })

    recorder.onBeforeQuit(['/shell/a.docx'], ['/detached/d.xlsx'])
    recorder.onQuitVetoed()
    recorder.onShellClosed(['/shell/a.docx', '/shell/new.docx'], [])

    expect(writes).toEqual([
      ['/shell/a.docx', '/detached/d.xlsx'],
      ['/shell/a.docx', '/shell/new.docx'],
    ])
  })
})
