import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BROWSER_RESERVED as GENERATOR_RESERVED,
  FIXTURE_PATH,
  MODULES,
  buildTables,
  chordsInRow,
  isZoomLabel,
  parseCsv,
  renderTableFile,
  tablePath,
  zoomAliases,
} from '../scripts/gen-tables.mjs'
import * as commonTable from '../src/tables/common'
import * as docsTable from '../src/tables/docs'
import * as htmlTable from '../src/tables/html'
import * as markdownTable from '../src/tables/markdown'
import * as pdfTable from '../src/tables/pdf'
import * as sheetsTable from '../src/tables/sheets'
import * as shellTable from '../src/tables/shell'
import * as slidesTable from '../src/tables/slides'
import {
  BROWSER_RESERVED,
  SHORTCUT_NOTES,
  SHORTCUT_TABLES,
  SHORTCUT_UNMAPPED,
  chordsFor,
  isBrowserReserved,
  isValidChord,
  mergeNotes,
  mergeRows,
  mergeUnmapped,
  pruneUnmapped,
  type ShortcutAction,
  type UnmappedShortcut,
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

  it('no generated unmapped entry names a part the merged table maps (a row entry: no chord anywhere)', () => {
    const modules = {
      ...commonTable,
      ...docsTable,
      ...htmlTable,
      ...markdownTable,
      ...pdfTable,
      ...sheetsTable,
      ...shellTable,
      ...slidesTable,
    } as unknown as Record<string, readonly UnmappedShortcut[] | undefined>
    const covered = Object.entries(SHORTCUT_UNMAPPED).flatMap(([scope, entries]) =>
      entries
        .filter((entry) => !modules[`${scope}ManualUnmapped`]?.includes(entry))
        .filter((entry) => {
          const action = SHORTCUT_TABLES[scope as keyof typeof SHORTCUT_TABLES].find(
            (a) => a.id === entry.id,
          )
          if (action === undefined) return false
          if (entry.part === 'row') {
            return SURFACES.some((surface) =>
              PLATFORMS.some((platform) => chordsFor(action, platform, surface).length > 0),
            )
          }
          const [surface, platform] = entry.part.split('.') as [ShortcutSurface, ShortcutPlatform]
          return chordsFor(action, platform, surface).length > 0
        })
        .map((entry) => `${scope} ${entry.id} ${entry.part}`),
    )
    expect(covered).toEqual([])
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

  it('zoom actions carry the keypad and Shift aliases (lead decision 3, RS-html-md M1)', () => {
    const missing: string[] = []
    for (const action of allActions) {
      if (!isZoomLabel(csvById.get(action.id)?.action ?? '')) continue
      for (const surface of SURFACES) {
        for (const platform of PLATFORMS) {
          const chords = chordsFor(action, platform, surface)
          for (const chord of chords) {
            for (const alias of zoomAliases(chord, platform) as string[]) {
              if (chords.includes(alias)) continue
              const elsewhere = SHORTCUT_TABLES[action.scope].some(
                (other) =>
                  other.id !== action.id &&
                  (other.context ?? '') === (action.context ?? '') &&
                  PLATFORMS.some((p) =>
                    SURFACES.some((s) =>
                      chordsFor(other, p, s).some((c) =>
                        /^(Ctrl\+Shift|Shift\+Cmd)\+Equal$/.test(c),
                      ),
                    ),
                  ),
              )
              // Where Ctrl+Shift+= is another action's key (docs superscript) the exact chord wins.
              if (elsewhere && alias.includes('Shift+')) continue
              missing.push(`${action.id} ${surface}.${platform}: ${alias}`)
            }
          }
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('manual notes and unmapped entries are merged into the scope lists (lead decision 1)', () => {
    for (const scope of Object.keys(SHORTCUT_TABLES) as (keyof typeof SHORTCUT_TABLES)[]) {
      const t = {
        ...commonTable,
        ...docsTable,
        ...htmlTable,
        ...markdownTable,
        ...pdfTable,
        ...sheetsTable,
        ...shellTable,
        ...slidesTable,
      } as unknown as Record<string, readonly unknown[]>
      const generatedUnmapped = (t[`${scope}Unmapped`] ?? []) as readonly UnmappedShortcut[]
      const manualUnmapped = (t[`${scope}ManualUnmapped`] ?? ['missing export']) as never
      expect(SHORTCUT_UNMAPPED[scope]).toEqual(
        mergeUnmapped(generatedUnmapped, SHORTCUT_TABLES[scope], manualUnmapped),
      )
      // every manual entry is in the list, last and unchanged
      expect(
        SHORTCUT_UNMAPPED[scope].slice(-(manualUnmapped as unknown[]).length || undefined),
      ).toEqual((manualUnmapped as unknown[]).length ? manualUnmapped : SHORTCUT_UNMAPPED[scope])
      expect(SHORTCUT_NOTES[scope]).toEqual(
        mergeNotes(
          (t[`${scope}Notes`] ?? []) as never,
          (t[`${scope}ManualNotes`] ?? ['missing export']) as never,
          manualUnmapped,
        ),
      )
    }
  })

  it('a manual unmapped entry replaces the generated one for its id and part, in every scope', () => {
    const manualByScope = {
      docs: docsTable.docsManualUnmapped,
      sheets: sheetsTable.sheetsManualUnmapped,
    } as const
    for (const [scope, manual] of Object.entries(manualByScope)) {
      for (const own of manual) {
        const same = SHORTCUT_UNMAPPED[scope as keyof typeof SHORTCUT_TABLES].filter(
          (entry) => entry.id === own.id && (own.part === 'row' || entry.part === own.part),
        )
        expect(same, `${scope} ${own.id} ${own.part}`).toEqual(
          own.part === 'row' ? manual.filter((m) => m.id === own.id && m.part === 'row') : [own],
        )
      }
    }
    for (const scope of Object.keys(SHORTCUT_TABLES) as (keyof typeof SHORTCUT_TABLES)[]) {
      const seen = new Map<string, number>()
      for (const entry of SHORTCUT_UNMAPPED[scope]) {
        const key = `${entry.id} ${entry.part}`
        seen.set(key, (seen.get(key) ?? 0) + 1)
      }
      const duplicated = [...seen].filter(([, n]) => n > 1).map(([key]) => key)
      expect(duplicated, `${scope}: one reason per id and part`).toEqual([])
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

  it('common-09 (F6 region cycle) ignores a held key (RS-delta-core L3)', () => {
    const f6 = SHORTCUT_TABLES.common.find((action) => action.id === 'common-09')
    expect(f6?.win).toEqual(['F6', 'Shift+F6'])
    expect(f6?.guard.noRepeat).toBe(true)
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

  it('chordsInRow reads bare keys and F-keys the row prints (lead decision 2)', () => {
    const inRow = (id: string, platform: ShortcutPlatform = 'win') =>
      [...(chordsInRow(csvById.get(id), platform) as Set<string>)].sort()
    expect(inRow('slides-25')).toEqual(
      expect.arrayContaining(['N', 'Enter', 'PageDown', 'Right', 'Down', 'Space']),
    )
    expect(inRow('slides-26', 'mac')).toEqual(
      expect.arrayContaining(['P', 'PageUp', 'Left', 'Up', 'Delete']),
    )
    expect(inRow('slides-29', 'mac')).toEqual(expect.arrayContaining(['Escape', 'Minus']))
    expect(inRow('slides-30')).toEqual(expect.arrayContaining(['B', 'Period', 'W', 'Comma']))
    // Shift+letter is traced too ("B or Shift+B or Period (.)" is not the key "Shift+.")
    expect(inRow('slides-30', 'mac')).toEqual(
      expect.arrayContaining(['B', 'Shift+B', 'W', 'Shift+W', 'Period', 'Comma']),
    )
    expect(inRow('slides-30', 'mac')).not.toContain('Shift+Period')
    expect(inRow('slides-30')).not.toContain('Shift+B')
    expect(inRow('slides-31')).toContain('H')
    expect(inRow('pdf-14')).toEqual(
      expect.arrayContaining(['Space', 'Shift+Space', 'PageDown', 'PageUp']),
    )
    expect(inRow('pdf-15')).toEqual(
      expect.arrayContaining(['Home', 'End', 'Up', 'Down', 'Left', 'Right']),
    )
    expect(inRow('pdf-23')).toContain('Escape')
    expect(inRow('pdf-dialog-keys')).toEqual(expect.arrayContaining(['Enter', 'Escape']))
    // Nothing the row does not print: no stray letters from words, no "/" separators.
    expect(inRow('slides-25')).not.toContain('Tab')
    expect(inRow('slides-27')).not.toContain('Slash')
    expect(inRow('pdf-14')).not.toContain('D')
  })

  it('chordsInRow adds the zoom aliases on zoom rows only', () => {
    const win = (id: string) => chordsInRow(csvById.get(id), 'win') as Set<string>
    const mac = (id: string) => chordsInRow(csvById.get(id), 'mac') as Set<string>
    expect([...win('html-019')]).toEqual(
      expect.arrayContaining(['Ctrl+Equal', 'Ctrl+Shift+Equal', 'Ctrl+NumpadAdd']),
    )
    expect([...mac('html-019')]).toEqual(
      expect.arrayContaining(['Cmd+Equal', 'Shift+Cmd+Equal', 'Cmd+NumpadAdd']),
    )
    expect(win('html-020').has('Ctrl+NumpadSubtract')).toBe(true)
    expect(win('html-021').has('Ctrl+Numpad0')).toBe(true)
    expect(win('docs-085').has('Ctrl+NumpadAdd')).toBe(false) // mouse wheel zoom
    expect(win('sheets-19').has('Ctrl+NumpadAdd')).toBe(false)
  })

  it('adds the zoom aliases, except a Shift alias another row of the scope owns', () => {
    const row = (id: string, action: string, win: string, mac: string) => ({
      id,
      group: 'docs',
      action,
      ms_win: win,
      ms_mac: mac,
      status: 'same',
      desktop_today: `${win} / ${mac}`,
      web_today: 'none',
      proposal_desktop: `${win} / ${mac}`,
      proposal_web: `${win} / ${mac}`,
    })
    const zoomIn = row('docs-910', 'Zoom in', 'Ctrl+=', 'Cmd+=')
    const zoomOut = row('docs-911', 'Zoom out', 'Ctrl+-', 'Cmd+-')
    const reset = row('docs-912', 'Zoom 100%', 'Ctrl+0', 'Cmd+0')
    const byId = (rows: Record<string, string>[]) =>
      Object.fromEntries(
        buildTables(rows).docs.actions.map((a: ShortcutAction) => [a.id, [a.win, a.mac]]),
      )
    expect(byId([zoomIn, zoomOut, reset])).toEqual({
      'docs-910': [
        ['Ctrl+Equal', 'Ctrl+Shift+Equal', 'Ctrl+NumpadAdd'],
        ['Cmd+Equal', 'Shift+Cmd+Equal', 'Cmd+NumpadAdd'],
      ],
      'docs-911': [
        ['Ctrl+Minus', 'Ctrl+NumpadSubtract'],
        ['Cmd+Minus', 'Cmd+NumpadSubtract'],
      ],
      'docs-912': [
        ['Ctrl+0', 'Ctrl+Numpad0'],
        ['Cmd+0', 'Cmd+Numpad0'],
      ],
    })
    // A later row binding Ctrl+Shift+= on one platform keeps the Shift alias off both.
    const superscript = row('docs-913', 'Superscript', 'Ctrl+Shift+=', 'not documented')
    superscript.proposal_desktop = 'Win: Ctrl+Shift+='
    superscript.proposal_web = 'Win: Ctrl+Shift+='
    expect(byId([zoomIn, superscript])['docs-910']).toEqual([
      ['Ctrl+Equal', 'Ctrl+NumpadAdd'],
      ['Cmd+Equal', 'Cmd+NumpadAdd'],
    ])
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

describe('pruneUnmapped', () => {
  const row = (id: string, web: ShortcutAction['web']): ShortcutAction => ({
    id,
    scope: 'docs',
    win: ['Ctrl+O'],
    mac: ['Cmd+O'],
    ...(web ? { web } : {}),
    match: 'key',
    guard: {},
  })
  const entry = (id: string, part: UnmappedShortcut['part']): UnmappedShortcut => ({
    id,
    part,
    reason: 'x',
  })

  it('drops a generated entry whose surface and platform the table now maps', () => {
    const table = [row('a', { win: ['Ctrl+O'], mac: [] }), row('b', { win: [], mac: [] })]
    const generated = [
      entry('a', 'web.win'),
      entry('a', 'web.mac'),
      entry('b', 'web.win'),
      entry('a', 'desktop.win'),
      entry('a', 'row'),
      entry('gone', 'web.win'),
    ]
    expect(pruneUnmapped(generated, table)).toEqual([
      entry('a', 'web.mac'),
      entry('b', 'web.win'),
      entry('gone', 'web.win'),
    ])
  })

  it('drops a row entry once the merged row has a chord anywhere (RS-delta-core L1)', () => {
    const webOnly: ShortcutAction = {
      id: 'w',
      scope: 'docs',
      win: [],
      mac: [],
      web: { win: [], mac: ['Cmd+K'] },
      match: 'key',
      guard: {},
    }
    const none: ShortcutAction = { ...webOnly, id: 'n', web: { win: [], mac: [] } }
    expect(
      pruneUnmapped(
        [entry('a', 'row'), entry('w', 'row'), entry('n', 'row')],
        [row('a', undefined), webOnly, none],
      ),
    ).toEqual([entry('n', 'row')])
  })

  it('counts a webAlt chord as a web key', () => {
    const alt = { ...row('a', { win: [], mac: [] }), webAlt: { win: 'Ctrl+Alt+O' } }
    expect(pruneUnmapped([entry('a', 'web.win'), entry('a', 'web.mac')], [alt])).toEqual([
      entry('a', 'web.mac'),
    ])
  })
})

describe('mergeUnmapped', () => {
  const row = (id: string): ShortcutAction => ({
    id,
    scope: 'docs',
    win: ['Ctrl+O'],
    mac: [],
    match: 'key',
    guard: {},
  })
  const entry = (id: string, part: UnmappedShortcut['part'], reason: string): UnmappedShortcut => ({
    id,
    part,
    reason,
  })

  it('substitutes a manual entry for the generated one of the same id and part', () => {
    const generated = [entry('a', 'desktop.mac', 'old'), entry('a', 'web.mac', 'old')]
    const manual = [entry('a', 'desktop.mac', 'new')]
    expect(mergeUnmapped(generated, [row('a')], manual)).toEqual([
      entry('a', 'web.mac', 'old'),
      entry('a', 'desktop.mac', 'new'),
    ])
  })

  it('a manual row entry replaces every generated entry for the id, and only that id', () => {
    const generated = [
      entry('a', 'row', 'old'),
      entry('a', 'desktop.mac', 'old'),
      entry('b', 'desktop.mac', 'kept'),
    ]
    expect(mergeUnmapped(generated, [row('a'), row('b')], [entry('a', 'row', 'new')])).toEqual([
      entry('b', 'desktop.mac', 'kept'),
      entry('a', 'row', 'new'),
    ])
  })

  it('without manual entries it is pruneUnmapped', () => {
    const generated = [entry('a', 'desktop.win', 'x'), entry('a', 'desktop.mac', 'x')]
    expect(mergeUnmapped(generated, [row('a')], [])).toEqual(pruneUnmapped(generated, [row('a')]))
  })
})

describe('mergeNotes', () => {
  const note = (id: string, part: 'web' | 'web.win' | 'web.mac', detail: string) => ({
    id,
    part,
    detail,
  })
  const unmapped = (id: string, part: UnmappedShortcut['part']): UnmappedShortcut => ({
    id,
    part,
    reason: 'x',
  })

  it('drops a generated note a manual unmapped entry now covers, keeps the rest, appends manual', () => {
    const generated = [note('a', 'web.mac', 'g'), note('b', 'web.mac', 'g'), note('c', 'web', 'g')]
    const manual = [note('d', 'web', 'm')]
    expect(
      mergeNotes(generated, manual, [unmapped('a', 'web.mac'), unmapped('c', 'web.win')]),
    ).toEqual([note('b', 'web.mac', 'g'), note('d', 'web', 'm')])
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
