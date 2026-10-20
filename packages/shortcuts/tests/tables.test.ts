import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BROWSER_RESERVED as GENERATOR_RESERVED,
  FIXTURE_PATH,
  MODULES,
  buildTables,
  chordsInRow,
  parseCsv,
  renderTableFile,
  tablePath,
} from '../scripts/gen-tables.mjs'
import {
  BROWSER_RESERVED,
  SHORTCUT_NOTES,
  SHORTCUT_TABLES,
  SHORTCUT_UNMAPPED,
  chordsFor,
  isBrowserReserved,
  isValidChord,
  mergeRows,
  type ShortcutAction,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '../src/index'

const PLATFORMS: readonly ShortcutPlatform[] = ['win', 'mac']
const SURFACES: readonly ShortcutSurface[] = ['desktop', 'web']
const csvRows = parseCsv(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, string>[]
const csvIds = new Set(csvRows.map((row) => row.id))
const allActions = Object.values(SHORTCUT_TABLES).flat()
const allUnmapped = Object.values(SHORTCUT_UNMAPPED).flat()
const allNotes = Object.values(SHORTCUT_NOTES).flat()
const csvById = new Map(csvRows.map((row) => [row.id, row]))

describe('table locks', () => {
  it('(i) no two actions share a chord in the same scope, context, surface and platform', () => {
    const owners = new Map<string, string>()
    const clashes: string[] = []
    for (const action of allActions) {
      for (const surface of SURFACES) {
        for (const platform of PLATFORMS) {
          for (const chord of chordsFor(action, platform, surface)) {
            const slot = [action.scope, action.context ?? '', surface, platform, chord].join('|')
            const owner = owners.get(slot)
            if (owner && owner !== action.id) clashes.push(`${slot}: ${owner} vs ${action.id}`)
            else owners.set(slot, action.id)
          }
        }
      }
    }
    expect(clashes).toEqual([])
  })

  it('(ii) no browser-reserved chord in a web column (only webAlt may stand in for one)', () => {
    const offenders = allActions.flatMap((action) =>
      PLATFORMS.flatMap((platform) =>
        (action.web ?? action)[platform]
          .filter((chord) => isBrowserReserved(chord, platform))
          .map((chord) => `${action.id} web.${platform}: ${chord}`),
      ),
    )
    const reservedAlts = allActions.flatMap((action) =>
      PLATFORMS.filter((p) => {
        const alt = action.webAlt?.[p]
        return alt !== undefined && isBrowserReserved(alt, p)
      }).map((p) => `${action.id} webAlt.${p}`),
    )
    expect(offenders).toEqual([])
    expect(reservedAlts).toEqual([])
  })

  it('(iii) every table row, unmapped and note id exists in the CSV snapshot', () => {
    const missing = [...allActions, ...allUnmapped, ...allNotes]
      .map((row) => row.id)
      .filter((id) => !csvIds.has(id))
    expect(missing).toEqual([])
  })

  it('each action sits in the table of its own scope, once', () => {
    for (const [scope, table] of Object.entries(SHORTCUT_TABLES)) {
      const ids = table.map((action) => action.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(table.every((action) => action.scope === scope)).toBe(true)
    }
  })

  it('every chord is canonical and valid on its platform', () => {
    const invalid = allActions.flatMap((action) =>
      SURFACES.flatMap((surface) =>
        PLATFORMS.flatMap((platform) =>
          chordsFor(action, platform, surface)
            .filter((chord) => !isValidChord(chord, platform))
            .map((chord) => `${action.id} ${surface}.${platform}: ${chord}`),
        ),
      ),
    )
    expect(invalid).toEqual([])
  })

  it('Ctrl+Alt chords on Windows carry the AltGr guard', () => {
    const unguarded = allActions.filter(
      (action) =>
        SURFACES.some((surface) =>
          chordsFor(action, 'win', surface).some((chord) => chord.startsWith('Ctrl+Alt+')),
        ) && !action.guard.altGraph,
    )
    expect(unguarded.map((action) => action.id)).toEqual([])
  })

  it('every desktop chord is printed in its own CSV row (MS, proposal or today columns)', () => {
    const untraced = allActions.flatMap((action) =>
      PLATFORMS.flatMap((platform) => {
        const inRow = chordsInRow(csvById.get(action.id), platform) as Set<string>
        return action[platform]
          .filter((chord) => !inRow.has(chord))
          .map((chord) => `${action.id} ${platform}: ${chord}`)
      }),
    )
    expect(untraced).toEqual([])
  })

  it('an action with no chord on a surface and platform says why (RS-table M3)', () => {
    const explained = new Set(
      [...allUnmapped, ...allNotes.filter((note) => note.part.startsWith('web'))].map(
        (entry) => `${entry.id}|${entry.part}`,
      ),
    )
    const silent = allActions.flatMap((action) =>
      SURFACES.flatMap((surface) =>
        PLATFORMS.filter((platform) => chordsFor(action, platform, surface).length === 0)
          .map((platform) => `${surface}.${platform}`)
          .filter(
            (part) =>
              !explained.has(`${action.id}|${part}`) &&
              !explained.has(`${action.id}|${part.split('.')[0]}`),
          )
          .map((part) => `${action.id} ${part}`),
      ),
    )
    expect(silent).toEqual([])
  })

  it('unmapped lists missing keys only; notes live apart (RS-table L6)', () => {
    expect(allUnmapped.every((entry) => entry.part === 'row' || entry.part.includes('.'))).toBe(
      true,
    )
    const notes = allUnmapped.filter((entry) =>
      /^(the browser keeps|\S+ is browser-reserved|no web chord \(|webAlt keeps)/.test(
        entry.reason,
      ),
    )
    expect(notes).toEqual([])
  })

  it('reserves the Chromium tab and exit keys on both platforms (RS-table L2)', () => {
    expect(isBrowserReserved('Ctrl+Shift+Q', 'win')).toBe(true)
    for (const chord of [
      'Ctrl+PageDown',
      'Ctrl+PageUp',
      'Alt+Cmd+Right',
      'Alt+Cmd+Left',
      'Shift+Cmd+BracketRight',
      'Shift+Cmd+BracketLeft',
    ]) {
      expect(isBrowserReserved(chord, 'mac')).toBe(true)
    }
  })

  it('maps the rows the contract calls out', () => {
    const find = (scope: keyof typeof SHORTCUT_TABLES, id: string) =>
      SHORTCUT_TABLES[scope].find((action) => action.id === id)
    // Word: insert comment / heading are Ctrl+Alt on Windows, Cmd+Option on Mac.
    expect(find('docs', 'docs-056')).toMatchObject({ win: ['Ctrl+Alt+1'], mac: ['Alt+Cmd+1'] })
    // PowerPoint: new slide is Ctrl+M on Windows but Cmd+Shift+N on Mac.
    expect(find('slides', 'slides-14')).toMatchObject({ win: ['Ctrl+M'], mac: ['Shift+Cmd+N'] })
    // Excel web: the browser keeps Ctrl+PgDn, Microsoft documents Ctrl+Alt+PgDn.
    expect(find('sheets', 'sheets-39')?.webAlt?.win).toBe('Ctrl+Alt+PageDown')
  })
})

describe('generator', () => {
  it('the checked-in tables match the CSV snapshot (run `npm run gen -w @genoffice/shortcuts`)', () => {
    const tables = buildTables(csvRows)
    for (const module of MODULES as string[]) {
      const onDisk = readFileSync(tablePath(module), 'utf8')
      expect(renderTableFile(module, tables[module], onDisk)).toBe(onDisk)
    }
  })

  it('uses the same browser-reserved list as the runtime', () => {
    expect(GENERATOR_RESERVED).toEqual(BROWSER_RESERVED)
  })

  it("reads a bare KEEP only when today's binding shows the Microsoft chord", () => {
    const row = {
      id: 'docs-900',
      group: 'docs',
      action: 'Example',
      ms_win: 'Ctrl+B',
      ms_mac: 'Cmd+B',
      status: 'same',
      desktop_today: 'Ctrl+B / Cmd+B (menu)',
      web_today: 'Ctrl+B / Cmd+B',
      proposal_desktop: 'KEEP',
      proposal_web: 'KEEP',
    }
    const kept = buildTables([row]).docs.actions[0]
    expect(kept).toMatchObject({ win: ['Ctrl+B'], mac: ['Cmd+B'] })
    const unconfirmed = buildTables([{ ...row, desktop_today: 'Ctrl+E', web_today: 'Ctrl+E' }])
    expect(unconfirmed.docs.actions).toEqual([])
    expect(unconfirmed.docs.unmapped[0]).toMatchObject({ id: 'docs-900', part: 'row' })
  })

  it('leaves prose and conditional proposals unmapped instead of guessing', () => {
    const row = {
      id: 'docs-901',
      group: 'docs',
      action: 'Example',
      ms_win: 'Ctrl+Q',
      ms_mac: 'not documented',
      status: 'missing',
      desktop_today: 'none',
      web_today: 'none',
      proposal_desktop: 'Ctrl+Q (MS) if the feature exists',
      proposal_web: 'Ctrl+Q / not documented (defer)',
    }
    const tables = buildTables([row])
    expect(tables.docs.actions).toEqual([])
    expect(tables.docs.unmapped.map((u: { part: string }) => u.part)).toEqual(['row'])
  })

  it('keeps the confirmed platform when KEEP fails on the other (RS-table M2)', () => {
    const row = {
      id: 'docs-903',
      group: 'docs',
      action: 'Example',
      ms_win: 'Ctrl+W',
      ms_mac: 'Control+W',
      status: 'same',
      desktop_today: 'Win: Ctrl+W; Mac: none',
      web_today: 'none',
      proposal_desktop: 'KEEP',
      proposal_web: 'Ctrl+W / not documented',
    }
    const { actions, unmapped } = buildTables([row]).docs
    expect(actions[0]).toMatchObject({ id: 'docs-903', win: ['Ctrl+W'], mac: [] })
    expect(unmapped).toContainEqual(
      expect.objectContaining({ id: 'docs-903', part: 'desktop.mac' }),
    )
    expect(unmapped.map((u: { part: string }) => u.part)).not.toContain('desktop.win')
  })

  it('does not copy a neutral chord to macOS when Microsoft prints no Mac key (RS-table L3)', () => {
    const row = {
      id: 'docs-904',
      group: 'docs',
      action: 'Help',
      ms_win: 'F1',
      ms_mac: 'not documented',
      status: 'same',
      desktop_today: 'F1 / Cmd+/',
      web_today: 'none',
      proposal_desktop: 'F1',
      proposal_web: 'F1 / not documented',
    }
    const { actions, unmapped } = buildTables([row]).docs
    expect(actions[0]).toMatchObject({ win: ['F1'], mac: [] })
    expect(unmapped).toContainEqual(
      expect.objectContaining({ id: 'docs-904', part: 'desktop.mac' }),
    )
  })

  it('marks editing commands noRepeat and lets undo, zoom and navigation repeat (RS-table M1)', () => {
    const row = (id: string, action: string, chord: string) => ({
      id,
      group: 'docs',
      action,
      ms_win: chord,
      ms_mac: 'not documented',
      status: 'same',
      desktop_today: chord,
      web_today: chord,
      proposal_desktop: `Win: ${chord}`,
      proposal_web: `Win: ${chord}`,
    })
    const guards = Object.fromEntries(
      buildTables([
        row('docs-905', 'Save', 'Ctrl+S'),
        row('docs-906', 'Undo', 'Ctrl+Z'),
        row('docs-907', 'Zoom in', 'Ctrl+Plus'),
        row('docs-908', 'Extend selection', 'Ctrl+Shift+Down'),
        row('docs-909', 'Heading 1', 'Ctrl+Alt+1'),
      ]).docs.actions.map((a: ShortcutAction) => [a.id, a.guard]),
    )
    expect(guards).toEqual({
      'docs-905': { noRepeat: true },
      'docs-906': {},
      'docs-907': {},
      'docs-908': {},
      'docs-909': { altGraph: true, noRepeat: true },
    })
  })

  it('drops browser-reserved web chords and keeps ALT-PROPOSED chords as webAlt', () => {
    const row = {
      id: 'docs-902',
      group: 'docs',
      action: 'Example',
      ms_win: 'Ctrl+N',
      ms_mac: 'Cmd+N',
      status: 'same',
      desktop_today: 'Ctrl+N / Cmd+N',
      web_today: 'none',
      proposal_desktop: 'Ctrl+N / Cmd+N (MS)',
      proposal_web: 'Alt+Shift+N / not documented',
      proposal_web_basis: 'ALT-PROPOSED',
    }
    const [action] = buildTables([row]).docs.actions
    expect(action).toMatchObject({
      win: ['Ctrl+N'],
      mac: ['Cmd+N'],
      web: { win: [], mac: [] },
      webAlt: { win: 'Alt+Shift+N' },
    })
  })
})

describe('mergeRows', () => {
  const base: ShortcutAction = {
    id: 'docs-004',
    scope: 'docs',
    win: ['Ctrl+S'],
    mac: ['Cmd+S'],
    match: 'key',
    guard: {},
  }

  it('replaces a generated row by id and appends new ones', () => {
    const override = { ...base, win: ['Ctrl+S', 'Shift+F12'] }
    const extra = { ...base, id: 'docs-005', win: ['F12'], mac: ['Shift+Cmd+S'] }
    expect(mergeRows([base], [override, extra])).toEqual([override, extra])
  })
})
