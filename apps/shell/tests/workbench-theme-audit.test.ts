/**
 * Workbench redesign sweep (spec §2, §5, §6): the Workbench part of home.css
 * paints with tokens only, defines no class the renderer never uses, stops the
 * press scale under reduced motion, and every text/background pair it paints
 * meets WCAG in the light, dark and system-dark blocks. Dashed borders and pill
 * shapes are locked by workbench-surfaces.test.ts.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', 'src', 'renderer', 'src')
const home = readFileSync(join(SRC, 'home.css'), 'utf8')
const tokens = readFileSync(join(__dirname, '..', '..', '..', 'packages/ui/src/tokens.css'), 'utf8')

/** "Workbench" up to "File search", plus "Workbench server tabs" to the end, comments removed */
function workbenchCss(): string {
  const a = home.indexOf('/* ── Workbench ── */')
  const b = home.indexOf('/* ── File search (home toolbar) ── */')
  const c = home.indexOf('/* ── Workbench server tabs')
  if (a < 0 || b < a || c < b) throw new Error('Workbench region markers moved')
  return (home.slice(a, b) + home.slice(c)).replace(/\/\*[\s\S]*?\*\//g, '')
}
const region = workbenchCss()

/** innermost `selector { declarations }` pairs; an @media wrapper is skipped, its rules are kept */
const rules = [...region.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1]!.trim().replace(/\s+/g, ' '),
  body: m[2]!,
}))
const selectorsWhere = (re: RegExp) => rules.filter((r) => re.test(r.body)).map((r) => r.selector)

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/

/** the Workbench components (chrome inline styles must not carry raw colours either) */
const WORKBENCH_TSX = [
  'WorkbenchTopBar.tsx',
  'WorkbenchTabs.tsx',
  'DeskView.tsx',
  'DeskTools.tsx',
  'DeskInTray.tsx',
  'DeskInProgress.tsx',
  'DeskDrawer.tsx',
  'DeskToday.tsx',
  'WorkTasksPane.tsx',
  'WorkCalendarPane.tsx',
  'WorkProfilePane.tsx',
  'WorkbenchModulePanes.tsx',
  'NotesPane.tsx',
  'PracticeHome.tsx',
  'WorkErrorState.tsx',
  'WorkToolbar.tsx',
  'WbMenu.tsx',
  'WbConfirm.tsx',
  'WbToastHost.tsx',
  'FileBadge.tsx',
  'WorkbenchIcons.tsx',
  'WbRowActions.tsx',
  'SkillDomainTabs.tsx',
  'LocalTag.tsx',
]
const tsx = (name: string) => readFileSync(join(SRC, name), 'utf8')

describe('Workbench CSS sweep', () => {
  it('paints with tokens only (raw colours live on custom-property lines)', () => {
    const raw = region
      .split('\n')
      .filter((line) => RAW_COLOR.test(line) && !/^\s*--[\w-]+:/.test(line))
    expect(raw).toEqual([])
    for (const name of WORKBENCH_TSX) expect(tsx(name), name).not.toMatch(RAW_COLOR)
  })

  it('paints text in AA colours: no --text-tertiary (except locked controls), no bare --danger', () => {
    // a disabled control is exempt from WCAG contrast; locked reads as neutral grey (spec 1.4)
    expect(
      selectorsWhere(/(?:^|[\s;])color:\s*var\(--text-tertiary\)/).filter(
        (s) => !s.split(',').every((part) => part.includes(':disabled')),
      ),
    ).toEqual([])
    expect(selectorsWhere(/(?:^|[\s;])color:\s*var\(--danger\)/)).toEqual([])
    // placeholder-only inputs: the UA default #757575 misses 4.5:1 on dark surfaces;
    // --text-secondary on --surface / --wb-row-hover is checked in PAIRS below
    const placeholder = rules.find(
      (r) => r.selector === '.wb-home :is(input, textarea)::placeholder',
    )
    expect(placeholder?.body).toMatch(/(?:^|[\s;])color:\s*var\(--text-secondary\)/)
  })

  it('keeps the tick state and the active tab visible in forced-colors mode', () => {
    // forced colors repaint `color`, so the unticked box hides its tick with visibility
    expect(selectorsWhere(/(?:^|[\s;])color:\s*transparent/)).toEqual([])
    const body = (selector: string) => rules.find((r) => r.selector === selector)?.body ?? ''
    expect(body('.wb-check-box svg')).toMatch(/visibility:\s*hidden/)
    expect(body('.wb-check input:checked + .wb-check-box svg')).toMatch(/visibility:\s*visible/)
    const forced = [...region.matchAll(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/g)]
    const override = (selector: RegExp) =>
      forced.find((m) =>
        new RegExp(
          `${selector.source}\\s*\\{[^}]*forced-color-adjust: none;[^}]*background: Highlight;`,
        ).test(m[1]!),
      )
    expect(override(/\.wb-check input:checked \+ \.wb-check-box/)).toBeDefined()
    // same specificity: the override only wins when it comes after the base underline rule
    const tab = override(/\n {2}\.wb-tab\.active::after/)
    expect(tab).toBeDefined()
    expect(tab!.index).toBeGreaterThan(region.indexOf('\n.wb-tab.active::after {'))
  })

  it('defines no class the renderer never uses', () => {
    const source = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => readFileSync(join(SRC, f), 'utf8'))
      .join('\n')
    const literal = new Set(source.match(/(?:wb|skill-domain)-[a-z0-9-]+/g) ?? [])
    // `wb-btn-${variant}`: a template prefix covers every class it can build
    const prefixes = [...source.matchAll(/((?:wb|skill-domain)-[a-z0-9-]*-)\$\{/g)].map(
      (m) => m[1]!,
    )
    const defined = new Set(
      [...region.matchAll(/\.((?:wb|skill-domain)-[a-z0-9-]+)/g)].map((m) => m[1]!),
    )
    const unused = [...defined].filter(
      (c) => !literal.has(c) && !prefixes.some((p) => c.startsWith(p)),
    )
    expect(unused).toEqual([])
  })

  it('stops the press scale and the shimmer under reduced motion', () => {
    const motion = [
      ...region.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g),
    ]
      .map((m) => m[1])
      .join('\n')
    expect(motion).toMatch(/\.wb-btn:active[^{]*\{[^}]*transform: none/)
    expect(motion).toMatch(/\.wb-icon-btn:active[^{]*\{[^}]*transform: none/)
    expect(motion).toMatch(/\.wb-skel[^{]*\{[^}]*animation: none/)
  })

  it('Workbench components use .wb-btn only; the skill confirm is a WbConfirm, not a .modal', () => {
    for (const name of WORKBENCH_TSX) {
      expect(tsx(name), name).not.toMatch(/\bbtn btn-/)
      expect(tsx(name), name).not.toContain('className="modal')
    }
  })

  it('no window.confirm: deletes ask through the in-app WbConfirm', () => {
    for (const name of WORKBENCH_TSX) expect(tsx(name), name).not.toMatch(/window\.confirm/)
  })
})

const OPENERS = {
  light: '\n:root {',
  dark: "\n[data-theme='dark'] {",
  system: '\n@media (prefers-color-scheme: dark) {',
} as const
type Theme = keyof typeof OPENERS

function hexIn(source: string, theme: Theme, name: string): string | undefined {
  const start = source.indexOf(OPENERS[theme])
  if (start < 0) return undefined
  const block = source.slice(start, source.indexOf('\n}', start + 1))
  const hex = new RegExp(`\\n\\s*${name}:\\s*(#[0-9a-fA-F]{3,6})\\b`).exec(block)?.[1]
  return hex?.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex
}
/** the shell accent family lives in home.css, everything else in tokens.css */
function token(theme: Theme, name: string): string {
  const hex = hexIn(home, theme, name) ?? hexIn(tokens, theme, name)
  if (!hex) throw new Error(`${name} has no hex value in the ${theme} block`)
  return hex
}
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const TEXT = 4.5
/** non-text UI parts: checkbox outline */
const UI = 3
const PAIRS: readonly (readonly [fg: string, bg: string, min: number])[] = [
  ...['--surface', '--wb-row-hover', '--hover', '--surface-subtle', '--accent-soft'].map(
    (bg) => ['--text', bg, TEXT] as const,
  ),
  ...[
    '--surface',
    '--wb-row-hover',
    '--bg-content',
    '--surface-subtle',
    '--hover',
    '--accent-soft',
  ].map((bg) => ['--text-secondary', bg, TEXT] as const),
  ...['--surface', '--wb-row-hover', '--bg-content', '--danger-bg'].map(
    (bg) => ['--danger-text', bg, TEXT] as const,
  ),
  ...['--warning-bg', '--surface', '--wb-row-hover'].map(
    (bg) => ['--warning-text', bg, TEXT] as const,
  ),
  ['--info', '--info-bg', TEXT],
  ['--success', '--success-bg', TEXT],
  // the Desk: a live meeting's sub-line on the Today card, and the sign-in / offline banner
  ['--success', '--surface', TEXT],
  ['--text', '--info-bg', TEXT],
  ['--text', '--warning-bg', TEXT],
  ['--on-accent', '--accent', TEXT],
  ['--on-accent', '--accent-hover', TEXT],
  ...['--surface', '--bg-content', '--wb-row-hover'].map((bg) => ['--accent', bg, TEXT] as const),
  // Knowledge: the selected pack's title
  ['--accent-text', '--accent-soft', TEXT],
  ['--wb-check-border', '--surface', UI],
  ['--wb-check-border', '--wb-row-hover', UI],
  ...['gray', 'green', 'yellow', 'violet', 'blue', 'teal', 'pink'].map(
    (t) => [`--tint-${t}-fg`, `--tint-${t}`, TEXT] as const,
  ),
]

describe('Workbench colour pairs', () => {
  it.each(Object.keys(OPENERS) as Theme[])(
    '%s: every pair the Workbench paints meets WCAG',
    (theme) => {
      const failing = PAIRS.map(([fg, bg, min]) => ({
        pair: `${fg} on ${bg}`,
        ratio: contrast(token(theme, fg), token(theme, bg)),
        min,
      }))
        .filter((p) => p.ratio < p.min)
        .map((p) => `${p.pair}: ${p.ratio.toFixed(2)} < ${p.min}`)
      expect(failing).toEqual([])
    },
  )
})

/** rules that paint their own text on their own fill (review focus: dark contrast of the new pills) */
const PAINTED = [
  '.wb-pill',
  '.wb-pill.is-danger',
  '.wb-pill.is-warning',
  '.wb-pill.is-success',
  '.wb-pill.is-info',
  '.wb-tab-count',
  '.wb-tab-count.is-danger',
  '.wb-crumb',
  '.wb-crumb-mark',
  '.wb-btn-danger',
  '.wb-check input:checked + .wb-check-box',
]

describe('Workbench painted pills and tiles', () => {
  it.each(Object.keys(OPENERS) as Theme[])(
    '%s: the pills, chips and ticked box paint AA text on their own fill',
    (theme) => {
      const failing = PAINTED.flatMap((selector) => {
        const body = rules.find((r) => r.selector === selector)?.body ?? ''
        const fg = /(?:^|[\s;])color:\s*var\((--[\w-]+)\)/.exec(body)?.[1]
        const bg = /(?:^|[\s;])background:\s*var\((--[\w-]+)\)/.exec(body)?.[1]
        if (!fg || !bg) return [`${selector}: no color/background pair`]
        const ratio = contrast(token(theme, fg), token(theme, bg))
        return ratio < TEXT ? [`${selector}: ${fg} on ${bg} ${ratio.toFixed(2)}`] : []
      })
      expect(failing).toEqual([])
    },
  )
})
