import { describe, expect, it } from 'vitest'
import {
  filterLastSessionDocuments,
  launchPathsWithLastSession,
  openLaunchSequence,
  readLastSessionDocuments,
} from '../src/main/last-session'

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
