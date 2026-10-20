#!/usr/bin/env node
// Generates src/tables/<module>.ts from the UNI-2011 shortcut inventory.
//
//   node scripts/gen-tables.mjs --from <path/to/shortcuts.csv>
//       snapshot the needed columns into tests/fixtures/shortcuts.csv, then generate
//   node scripts/gen-tables.mjs            regenerate from the snapshot
//   node scripts/gen-tables.mjs --check    exit 1 when a table is out of date
//
// Only the block between the @generated markers of each table file is
// rewritten; hand-maintained rows outside it survive regeneration.
//
// The CSV proposals are prose. A proposal becomes chords only when it is
// nothing but chords, platform labels (`Win:`, `mac`) and a few filler words
// (KEEP, alias, and, or...); anything else (conditions, decisions, "unverified")
// leaves the row in the module's `unmapped` list with the reason. A bare KEEP
// means "keep today's key": it resolves to the Microsoft chord only when the
// row's current-binding column shows that same chord, so no key is invented.
// Web chords come from `proposal_web` (KEEP resolves against `ms_web_win` /
// `ms_web_mac` when those columns exist, else `ms_win` / `ms_mac`); chords the
// browser reserves are dropped from the web column, and an `ALT-PROPOSED`
// chord becomes the action's `webAlt`.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const FIXTURE_PATH = join(PACKAGE_DIR, 'tests', 'fixtures', 'shortcuts.csv')
const TABLES_DIR = join(PACKAGE_DIR, 'src', 'tables')

/** CSV group → table module. `global` and `uninote` belong to the uniwork repo. */
export const MODULES = ['common', 'shell', 'docs', 'sheets', 'slides', 'pdf', 'html', 'markdown']

export const SNAPSHOT_COLUMNS = [
  'id',
  'group',
  'action',
  'ms_win',
  'ms_mac',
  'ms_web_win',
  'ms_web_mac',
  'status',
  'desktop_today',
  'web_today',
  'proposal_desktop',
  'proposal_web',
  'proposal_web_basis',
]

/** Kept in sync with src/browser-reserved.ts (a test compares the two). */
export const BROWSER_RESERVED = {
  win: [
    'Ctrl+W',
    'Ctrl+F4',
    'Ctrl+Shift+W',
    'Ctrl+N',
    'Ctrl+Shift+N',
    'Ctrl+T',
    'Ctrl+Shift+T',
    'Ctrl+Tab',
    'Ctrl+Shift+Tab',
    'Ctrl+PageDown',
    'Ctrl+PageUp',
    'Ctrl+Shift+Q',
    'Alt+F4',
  ],
  mac: [
    'Cmd+W',
    'Shift+Cmd+W',
    'Cmd+N',
    'Shift+Cmd+N',
    'Cmd+T',
    'Shift+Cmd+T',
    'Cmd+Q',
    'Ctrl+Tab',
    'Ctrl+Shift+Tab',
    'Ctrl+PageDown',
    'Ctrl+PageUp',
    'Alt+Cmd+Right',
    'Alt+Cmd+Left',
    'Shift+Cmd+BracketRight',
    'Shift+Cmd+BracketLeft',
  ],
}

// ---------------------------------------------------------------- CSV

/** RFC 4180 CSV; lines starting with `#` before the header are comments. */
export function parseCsv(text) {
  const body = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(
      (line, index, lines) =>
        !(line.startsWith('#') && lines.slice(0, index).every((l) => l.startsWith('#'))),
    )
    .join('\n')
  const records = []
  let record = []
  let field = ''
  let quoted = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\n') {
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else field += ch
  }
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }
  const [header, ...rows] = records.filter((r) => r.length > 1 || r[0] !== '')
  return rows.map((r) => Object.fromEntries(header.map((name, i) => [name, r[i] ?? ''])))
}

function csvField(value) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function snapshotCsv(rows, sourcePath, date) {
  const columns = SNAPSHOT_COLUMNS.filter((c) => rows.some((r) => c in r))
  const lines = [
    `# Snapshot of the UNI-2011 shortcut inventory (columns used by scripts/gen-tables.mjs).`,
    `# source: ${sourcePath.replace(/\\/g, '/')}`,
    `# date: ${date}`,
    columns.join(','),
    ...rows
      .filter((r) => MODULES.includes(r.group))
      .map((r) => columns.map((c) => csvField(r[c] ?? '')).join(',')),
  ]
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------- chords

const SHIFTED = {
  _: ['Minus'],
  '{': ['BracketLeft'],
  '}': ['BracketRight'],
  ':': ['Semicolon'],
  '"': ['Quote'],
  '~': ['Backquote'],
  '<': ['Comma'],
  '>': ['Period'],
  '?': ['Slash'],
  '|': ['Backslash'],
  '!': ['1'],
  '@': ['2'],
  '#': ['3'],
  $: ['4'],
  '%': ['5'],
  '^': ['6'],
  '&': ['7'],
  '*': ['8'],
  '(': ['9'],
  ')': ['0'],
}
const UNSHIFTED = {
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backquote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  // The "Plus key" is the =/+ key; Microsoft writes Shift explicitly when it is
  // needed (Word superscript Ctrl+Shift+Plus vs zoom Ctrl+Plus).
  '+': 'Equal',
}
const KEY_WORDS = [
  [/^page\s?down$|^pgdn$/i, 'PageDown'],
  [/^page\s?up$|^pgup$/i, 'PageUp'],
  [/^up\b/i, 'Up'],
  [/^down\b/i, 'Down'],
  [/^left\b/i, 'Left'],
  [/^right\b/i, 'Right'],
  [/^space/i, 'Space'],
  [/^(return|enter)$/i, 'Enter'],
  [/^esc(ape)?$/i, 'Escape'],
  [/^tab\b/i, 'Tab'],
  [/^backspace$/i, 'Backspace'],
  [/^del(ete)?$/i, 'Delete'],
  [/^insert$/i, 'Insert'],
  [/^home$/i, 'Home'],
  [/^end$/i, 'End'],
  [/^menu\s+key$/i, 'ContextMenu'],
  [/^plus/i, '+'],
  [/^(minus|hyphen)/i, '-'],
  [/^equal/i, '='],
  [/^zero$/i, '0'],
  [/^comma$/i, ','],
  [/^period$/i, '.'],
  [/^semicolon$/i, ';'],
  [/^apostrophe$/i, "'"],
  [/^backslash$/i, '\\'],
  [/^slash$/i, '/'],
]

const MOD_SRC = '(?:Ctrl|Control|Command|Cmd|⌘|Alt|Option|Opt|Shift|Function|Fn)'
const FKEY_SRC = 'F(?:2[0-4]|1[0-9]|[1-9])(?![0-9A-Za-z])'
const KEY_SRC = [
  FKEY_SRC,
  'Page\\s?down|Page\\s?up|PgDn|PgUp',
  '(?:Up|Down|Left|Right)(?:\\s+arrow(?:\\s+keys?)?)?(?![A-Za-z])',
  'Space(?:\\s?bar)?|Return|Enter|Escape|Esc|Tab(?:\\s+key)?|Backspace|Delete|Del|Insert|Home|End|Menu\\s+key',
  'Plus(?:\\s+sign)?|Minus(?:\\s+sign)?|Hyphen|Equal(?:\\s+sign)?|Zero|Comma|Period|Semicolon|Apostrophe|Backslash|Slash',
  '[A-Za-z](?![A-Za-z])',
  '[0-9](?![0-9])',
  '[-=\\[\\];\',./\\\\`+*<>()!@#$%^&_:"?{}|~]',
].join('|')
const CHORD_RE = new RegExp(
  `(?<![A-Za-z])(?:(?:${MOD_SRC}\\s*\\+\\s*)+(?:${KEY_SRC})|${FKEY_SRC})`,
  'gi',
)
const MOD_PREFIX_RE = new RegExp(`^(${MOD_SRC})\\s*\\+\\s*`, 'i')
const MAC_WORDS = /^(command|cmd|⌘|option|opt|control)$/i

/** "Ctrl+Minus sign (-)" → "Ctrl+-", "Ctrl+Zero (0)" → "Ctrl+0". */
function normalizeVerboseKeys(text) {
  return text.replace(/\+\s*([A-Za-z][A-Za-z' ]*?)\s*\(\s?(.)\s?\)/g, '+$2')
}

/** A note that makes the chord conditional ("defer", "once ...", "validate"). */
const CAVEAT_RE = /\b(defer|once|until|unverified|validate|decision|decide|stage 2|if)\b/i

function caveatIn(text) {
  return [...text.matchAll(/\(([^()]*)\)/g)].some((m) => CAVEAT_RE.test(m[1]))
}

function removeParentheticals(text) {
  let previous
  let current = text
  do {
    previous = current
    current = current.replace(/\([^()]*\)/g, ' ')
  } while (current !== previous)
  return current
}

/**
 * One chord match → { chord, side } where side is `win`, `mac` or `neutral`
 * (no Ctrl/Alt/Cmd, e.g. F12, Shift+F4). `platform` fixes how Ctrl/Alt read
 * (`mac` context: Ctrl is Control, Alt is Option); null classifies the chord
 * by its words. chord is null when it cannot exist on the platform.
 */
function toChord(raw, platform) {
  let rest = raw.trim()
  const words = []
  for (let m = MOD_PREFIX_RE.exec(rest); m; m = MOD_PREFIX_RE.exec(rest)) {
    words.push(m[1].toLowerCase())
    rest = rest.slice(m[0].length)
  }
  const macWord = words.some((w) => MAC_WORDS.test(w))
  const winWord = words.some((w) => w === 'ctrl' || w === 'alt')
  const side = platform ?? (macWord ? 'mac' : winWord ? 'win' : 'neutral')
  if (words.some((w) => w === 'fn' || w === 'function')) return { chord: null, side }
  const mods = { ctrl: false, alt: false, shift: false, cmd: false }
  for (const w of words) {
    if (w === 'ctrl' || w === 'control') mods.ctrl = true
    else if (w === 'alt' || w === 'option' || w === 'opt') mods.alt = true
    else if (w === 'shift') mods.shift = true
    else mods.cmd = true
  }
  if (side === 'win' && (mods.cmd || words.some((w) => /^(option|opt)$/.test(w)))) {
    return { chord: null, side }
  }
  let key = rest.trim()
  for (const [pattern, name] of KEY_WORDS) {
    if (pattern.test(key)) {
      key = name
      break
    }
  }
  if (/^f\d+$/i.test(key)) key = key.toUpperCase()
  else if (/^[a-z]$/i.test(key)) key = key.toUpperCase()
  else if (key in SHIFTED) {
    mods.shift = true
    key = SHIFTED[key][0]
  } else if (key in UNSHIFTED) key = UNSHIFTED[key]
  const parts = []
  if (mods.ctrl) parts.push('Ctrl')
  if (mods.alt) parts.push('Alt')
  if (mods.shift) parts.push('Shift')
  if (mods.cmd) parts.push('Cmd')
  parts.push(key)
  return { chord: parts.join('+'), side }
}

function findChords(text, platform) {
  const found = []
  for (const m of text.matchAll(CHORD_RE)) {
    found.push({ ...toChord(m[0], platform), start: m.index, end: m.index + m[0].length })
  }
  return found
}

function addUnique(list, chord) {
  if (!list.includes(chord)) list.push(chord)
}

/** Two chords joined by "/" or "," on the same side are two sub-actions. */
function compositeIn(text, found) {
  for (let i = 1; i < found.length; i++) {
    const between = text.slice(found[i - 1].end, found[i].start).trim()
    if (!/^[/,;]$/.test(between)) continue
    const a = found[i - 1].side
    const b = found[i].side
    if (!((a === 'win' && b === 'mac') || (a === 'mac' && b === 'win'))) return true
  }
  return false
}

/** Chords printed in a Microsoft column (`ms_win` / `ms_mac`), or null when the
 * cell lists several sub-actions ("Ctrl+X / Ctrl+C / Ctrl+V"). */
function msChords(cell, platform) {
  const chords = []
  for (const product of normalizeVerboseKeys(cell).split('|')) {
    const text = product.replace(/^\s*[A-Za-z ]+:\s*/, '')
    const found = findChords(text, platform)
    if (compositeIn(text, found)) return null
    for (const f of found) if (f.chord) addUnique(chords, f.chord)
  }
  return chords
}

/** Every chord a current-binding text mentions, per platform. Ctrl-only texts
 * describe Mod keys (Ctrl on Windows, Cmd on macOS). */
function todayChords(text) {
  const out = { win: new Set(), mac: new Set() }
  for (const segment of splitPlatforms(normalizeVerboseKeys(text))) {
    const found = findChords(segment.text, segment.platform)
    const hasMac = found.some((f) => f.side === 'mac')
    for (const f of found) {
      if (!f.chord) continue
      if (f.side !== 'mac') out.win.add(f.chord)
      if (f.side !== 'win') out.mac.add(f.chord)
      else if (!segment.platform && !hasMac) out.mac.add(ctrlToCmd(f.chord))
    }
  }
  return out
}

/** "Ctrl+Shift+S" → "Shift+Cmd+S" (canonical modifier order). */
function ctrlToCmd(chord) {
  const parts = chord.split('+')
  const key = parts.pop()
  return [...parts.filter((p) => p !== 'Ctrl'), 'Cmd', key].join('+')
}

const LABEL_RE = /(?<![A-Za-z])(windows|win|macos|mac)(?![A-Za-z])\s*:?/gi

function splitPlatforms(text) {
  const segments = []
  let platform = null
  let last = 0
  for (const m of text.matchAll(LABEL_RE)) {
    segments.push({ platform, text: text.slice(last, m.index) })
    platform = m[1].toLowerCase().startsWith('win') ? 'win' : 'mac'
    last = m.index + m[0].length
  }
  segments.push({ platform, text: text.slice(last) })
  return segments.filter((s) => s.text.trim() !== '' || s.platform)
}

const FILLER_RE = /\b(keep|add|alias(?:es)?|as|an|both|and|or|plus|also|ms)\b/gi

/** Proposal text without notes: verbose key names folded, "X (= Y)" read as
 * Y, parentheticals and trailing punctuation removed. */
function cleanProposal(proposal) {
  return removeParentheticals(
    normalizeVerboseKeys(proposal).replace(/[^\s()]+\s*\(=\s*([^()]+)\)/g, '$1'),
  )
    .replace(/next to Enter/gi, ' ')
    .replace(/[;.\s]+$/, '')
    .trim()
}

/**
 * One segment of a proposal: chords plus filler words only. `platform` is the
 * segment's label (null: classify each chord by its words). Returns
 * { found, keep } or { error }.
 */
function parseSegment(text, platform, proposal) {
  const found = findChords(text, platform)
  let leftover = text
  for (const f of [...found].reverse()) {
    leftover = leftover.slice(0, f.start) + ' ' + leftover.slice(f.end)
  }
  leftover = leftover.replace(FILLER_RE, ' ').replace(/[/;:,.\s]+/g, '')
  const quoted = `"${proposal.trim()}"`
  if (leftover !== '') return { error: `proposal has prose: ${quoted}` }
  if (compositeIn(text, found))
    return { error: `several chords for one row (sub-actions): ${quoted}` }
  if (found.some((f) => !f.chord)) return { error: `chord not valid on its platform: ${quoted}` }
  if (found.length === 0 && !/\bkeep\b/i.test(text)) return { error: `no chord: ${quoted}` }
  return { found, keep: found.length === 0 }
}

/** { win, mac, missing } once every platform is resolved; { error } when no
 * platform got a chord. `missing[platform]` says why one platform has none. */
function settle(result, missing) {
  const reasons = Object.values(missing)
  if (reasons.length > 0 && result.win.length + result.mac.length === 0) {
    return { error: [...new Set(reasons)].join('; ') }
  }
  return { ...result, missing }
}

/**
 * Parses one proposal. Returns { win, mac, missing } (chord lists, possibly
 * empty) or { error }. `resolveKeep(platform)` answers a bare KEEP for one
 * platform; a KEEP that fails on one platform keeps the other platform's
 * chords. `macUndocumented`: a chord without Ctrl/Alt/Cmd (F1, Shift+F4)
 * applies to Windows only, since Microsoft prints no Mac key for the row.
 */
function parseProposal(proposal, resolveKeep, { macUndocumented = false } = {}) {
  const text = cleanProposal(proposal)
  if (text === '') return { error: 'empty proposal' }
  if (caveatIn(proposal)) return { error: `proposal is conditional: "${proposal.trim()}"` }
  const result = { win: [], mac: [] }
  const keeps = []
  for (const segment of splitPlatforms(text)) {
    const parsed = parseSegment(segment.text, segment.platform, proposal)
    if (parsed.error) return parsed
    if (parsed.keep) {
      keeps.push(...(segment.platform ? [segment.platform] : ['win', 'mac']))
      continue
    }
    for (const f of parsed.found) {
      const side = segment.platform ?? f.side
      if (side !== 'mac') addUnique(result.win, f.chord)
      if (side === 'mac' || (side === 'neutral' && !macUndocumented)) {
        addUnique(result.mac, f.chord)
      }
    }
  }
  const missing = {}
  for (const platform of keeps) {
    const kept = resolveKeep(platform)
    if (kept.error) missing[platform] = kept.error
    else for (const chord of kept.chords) addUnique(result[platform], chord)
  }
  if (macUndocumented && result.mac.length === 0 && !missing.mac) {
    missing.mac = "Microsoft prints no Mac key; keep today's Mac binding (contract 3.1)"
  }
  return settle(result, missing)
}

const NOT_DOCUMENTED_RE = /^(not documented|none|n\/a)$/i

/**
 * The `proposal_web` form "WIN / MAC": left side read as Windows, right side
 * as macOS (where Ctrl is Control). Null when the text is not such a pair. On
 * a row whose action names several sub-actions ("Move up / down") only an
 * identical pair is accepted, since "A / B" there may be the two sub-actions.
 */
function parsePositional(proposal, label, resolveKeep) {
  const parts = cleanProposal(proposal).split(/\s+\/\s+/)
  if (parts.length !== 2) return null
  const [left, right] = parts.map((p) => p.trim())
  if (caveatIn(proposal)) return { error: `proposal is conditional: "${proposal.trim()}"` }
  // "Ctrl+A / Cmd+A" is still a platform pair; "Ctrl+Home / Ctrl+End" is not.
  const sideOf = (text) => findChords(text, null)[0]?.side
  if (label.includes('/') && left !== right && sideOf(left) === sideOf(right)) {
    return { error: `"WIN / MAC" pair on a row with several sub-actions: "${proposal.trim()}"` }
  }
  const result = { win: [], mac: [] }
  const notes = []
  const missing = {}
  for (const [platform, side] of [
    ['win', left],
    ['mac', right],
  ]) {
    if (NOT_DOCUMENTED_RE.test(side)) {
      notes.push(note(`web.${platform}`, `no web chord (${side})`))
      continue
    }
    const parsed = parseSegment(side, platform, proposal)
    if (parsed.error) return parsed
    if (parsed.keep) {
      const kept = resolveKeep(platform)
      if (kept.error) missing[platform] = kept.error
      else result[platform].push(...kept.chords)
    } else for (const f of parsed.found) addUnique(result[platform], f.chord)
  }
  const settled = settle(result, missing)
  return settled.error ? settled : { ...settled, notes }
}

/** A remark on a row that is not a missing key (a deliberate browser gap...). */
function note(part, text) {
  return { part, detail: text }
}

function keepResolver(row, surface) {
  const today =
    surface === 'web' || /^same\b/i.test(row.desktop_today)
      ? `${row.web_today} ${surface === 'desktop' ? row.desktop_today : ''}`
      : row.desktop_today
  const bound = todayChords(today)
  return (platform) => {
    if (row.action.includes('/')) {
      return { error: 'KEEP on a row that names several sub-actions' }
    }
    const webCell = surface === 'web' ? row[`ms_web_${platform}`] : ''
    const cell = webCell && !/not documented/i.test(webCell) ? webCell : row[`ms_${platform}`]
    const ms = msChords(cell ?? '', platform)
    if (ms === null)
      return { error: `KEEP: the Microsoft ${platform} cell lists several sub-actions` }
    const kept = ms.filter((chord) => bound[platform].has(chord))
    if (kept.length === 0) {
      return { error: `KEEP: no Microsoft ${platform} chord confirmed by today's binding` }
    }
    return { chords: kept }
  }
}

// ---------------------------------------------------------------- rows

const ALT_RE = /ALT-PROPOSED:?\s*/i
/** `proposal_web_basis` values whose chords stand in for a browser-kept key. */
const ALT_BASES = new Set(['ALT-PROPOSED', 'MS-WEB-ALT'])

function resolveDesktop(row, web) {
  const proposal = row.proposal_desktop.trim()
  if (/^(same )?as web$/i.test(removeParentheticals(proposal).trim())) {
    if (web.error) return { error: 'same as web, and web is unmapped' }
    return { win: web.win, mac: web.mac, missing: web.missing }
  }
  return parseProposal(proposal, keepResolver(row, 'desktop'), {
    macUndocumented: /^not documented$/i.test(row.ms_mac.trim()),
  })
}

function resolveWeb(row) {
  let proposal = row.proposal_web.trim()
  let webAlt
  const notes = []
  // Older inventory form: "KEEP browser Ctrl+N; ALT-PROPOSED Alt+Shift+N ...".
  const altAt = proposal.search(ALT_RE)
  if (altAt >= 0) {
    const after = normalizeVerboseKeys(proposal.slice(altAt).replace(ALT_RE, ''))
    const found = findChords(after, null)
    const first = found[0]
    const clauseEnd = after.search(/[;.](\s|$)/)
    if (first && first.start === 0 && first.chord && !compositeIn(after, found.slice(0, 2))) {
      webAlt = first.side === 'mac' ? { mac: first.chord } : { win: first.chord, mac: first.chord }
    } else {
      notes.push(note('web', `ALT-PROPOSED without a single chord: "${after.slice(0, 60).trim()}"`))
    }
    proposal = proposal.slice(0, altAt) + (clauseEnd >= 0 ? after.slice(clauseEnd + 1) : '')
  }
  if (/^\s*KEEP\s+browser\b/i.test(proposal)) {
    return {
      win: [],
      mac: [],
      webAlt,
      notes: [...notes, note('web', 'the browser keeps the Microsoft key')],
    }
  }
  const resolveKeep = keepResolver(row, 'web')
  const parsed =
    parsePositional(proposal, row.action, resolveKeep) ?? parseProposal(proposal, resolveKeep)
  if (parsed.error) return { error: parsed.error, webAlt, notes }
  notes.push(...(parsed.notes ?? []))
  const out = { win: [], mac: [], missing: parsed.missing, webAlt, notes }
  const isAlt = ALT_BASES.has((row.proposal_web_basis ?? '').trim())
  for (const platform of ['win', 'mac']) {
    const chords = parsed[platform].filter((chord) => {
      if (!BROWSER_RESERVED[platform].includes(chord)) return true
      notes.push(note(`web.${platform}`, `${chord} is browser-reserved`))
      return false
    })
    if (!isAlt) out[platform] = chords
    else if (chords.length > 0) {
      out.webAlt = { ...out.webAlt, [platform]: chords[0] }
      if (chords.length > 1) {
        notes.push(
          note(`web.${platform}`, `webAlt keeps ${chords[0]}, drops ${chords.slice(1).join(', ')}`),
        )
      }
    }
  }
  return out
}

/** Actions a held key may repeat: undo/redo, zoom, size and indent steps,
 * navigation, deletion and typed characters. Every other action (save, open,
 * dialogs, formatting toggles, paste...) ignores auto-repeated keydowns. */
const REPEATABLE_LABEL_RE =
  /\b(undo|redo|repeat|zoom (in|out)|increase|decrease|next|previous|cycle|delete (word|char)|line break|non-breaking|optional hyphen)\b/i
const REPEATABLE_KEYS = new Set([
  'Up',
  'Down',
  'Left',
  'Right',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'Backspace',
  'Delete',
])

function repeatable(label, chords) {
  return (
    REPEATABLE_LABEL_RE.test(label) ||
    (chords.length > 0 && chords.every((chord) => REPEATABLE_KEYS.has(chord.split('+').pop())))
  )
}

/** PowerPoint slide-show keys form their own keymap (MS lists them apart). */
function contextOf(row) {
  return row.group === 'slides' && /^Show:/.test(row.action) ? 'slideshow' : undefined
}

function sameLists(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/**
 * Builds { [module]: { actions, unmapped, notes } } from inventory rows.
 * `unmapped` names every missing key per surface and platform (or the whole
 * row); `notes` holds remarks that are not missing keys.
 */
export function buildTables(rows) {
  const tables = Object.fromEntries(
    MODULES.map((m) => [m, { actions: [], unmapped: [], notes: [] }]),
  )
  const owners = new Map() // `${scope}|${context}|${surface}|${platform}|${chord}` → id
  for (const row of rows) {
    if (!MODULES.includes(row.group)) continue
    const table = tables[row.group]
    const unmapped = (part, reason) => table.unmapped.push({ id: row.id, part, reason })
    const web = resolveWeb(row)
    const desktop = resolveDesktop(row, web)
    const keys = {
      desktop: {
        win: desktop.error ? [] : [...desktop.win],
        mac: desktop.error ? [] : [...desktop.mac],
      },
      web: { win: web.error ? [] : [...web.win], mac: web.error ? [] : [...web.mac] },
    }
    const webAlt = web.webAlt ? { ...web.webAlt } : undefined
    // An "alternative" that is the desktop chord itself is just the web chord.
    for (const platform of ['win', 'mac']) {
      const alt = webAlt?.[platform]
      if (alt && keys.desktop[platform].includes(alt)) {
        addUnique(keys.web[platform], alt)
        delete webAlt[platform]
      }
    }
    const context = contextOf(row)
    if (desktop.error && web.error && !webAlt) {
      unmapped(
        'row',
        desktop.error === web.error
          ? desktop.error
          : `desktop: ${desktop.error}; web: ${web.error}`,
      )
      continue
    }
    const explained = new Set()
    const missingPart = (part, reason) => {
      unmapped(part, reason)
      explained.add(part)
    }
    for (const [surface, result] of [
      ['desktop', desktop],
      ['web', web],
    ]) {
      for (const platform of ['win', 'mac']) {
        const reason = result.error ?? result.missing?.[platform]
        if (reason) missingPart(`${surface}.${platform}`, reason)
      }
    }
    for (const entry of web.notes ?? []) {
      table.notes.push({ id: row.id, ...entry })
      explained.add(entry.part)
    }
    // A chord belongs to the first row (CSV order) that claims it in a scope.
    for (const surface of ['desktop', 'web']) {
      for (const platform of ['win', 'mac']) {
        const list = keys[surface][platform]
        const claimed = surface === 'web' && webAlt?.[platform] ? [...list, webAlt[platform]] : list
        for (const chord of claimed) {
          const slot = `${row.group}|${context ?? ''}|${surface}|${platform}|${chord}`
          const owner = owners.get(slot)
          if (owner && owner !== row.id) {
            missingPart(`${surface}.${platform}`, `${chord} is already ${owner}'s chord`)
            if (list.includes(chord)) list.splice(list.indexOf(chord), 1)
            else delete webAlt[platform]
          } else owners.set(slot, row.id)
        }
      }
    }
    const silent = (part) => !explained.has(part) && !explained.has(part.split('.')[0])
    for (const platform of ['win', 'mac']) {
      if (keys.desktop[platform].length === 0 && silent(`desktop.${platform}`)) {
        missingPart(`desktop.${platform}`, `no ${platform} chord in proposal_desktop`)
      }
      if (keys.web[platform].length === 0 && !webAlt?.[platform] && silent(`web.${platform}`)) {
        missingPart(`web.${platform}`, `no ${platform} chord in proposal_web`)
      }
    }
    const total =
      keys.desktop.win.length + keys.desktop.mac.length + keys.web.win.length + keys.web.mac.length
    if (total === 0 && !(webAlt && (webAlt.win || webAlt.mac))) {
      unmapped('row', 'no chord left on any platform')
      continue
    }
    const action = { id: row.id, label: row.action, scope: row.group }
    if (context) action.context = context
    action.win = keys.desktop.win
    action.mac = keys.desktop.mac
    if (!(sameLists(keys.web.win, keys.desktop.win) && sameLists(keys.web.mac, keys.desktop.mac))) {
      action.web = keys.web
    }
    if (webAlt && (webAlt.win || webAlt.mac)) action.webAlt = webAlt
    action.match = 'key'
    const ctrlAlt = [...keys.desktop.win, ...keys.web.win, webAlt?.win ?? ''].some((c) =>
      c.startsWith('Ctrl+Alt+'),
    )
    action.guard = {}
    if (ctrlAlt) action.guard.altGraph = true
    if (!repeatable(row.action, [...keys.desktop.win, ...keys.desktop.mac])) {
      action.guard.noRepeat = true
    }
    table.actions.push(action)
  }
  return tables
}

/** Every chord a row's Microsoft, proposal and current-binding columns print
 * for one platform (a superset check for the table locks). */
export function chordsInRow(row, platform) {
  const out = new Set()
  for (const column of [
    `ms_${platform}`,
    `ms_web_${platform}`,
    'proposal_desktop',
    'proposal_web',
    'desktop_today',
    'web_today',
  ]) {
    const text = normalizeVerboseKeys(row[column] ?? '')
    for (const f of findChords(text, platform)) if (f.chord) out.add(f.chord)
    for (const chord of todayChords(text)[platform]) out.add(chord)
  }
  return out
}

// ---------------------------------------------------------------- emit

const PRINT_WIDTH = 100

function str(value) {
  const singles = (value.match(/'/g) ?? []).length
  const doubles = (value.match(/"/g) ?? []).length
  const escaped = value.replace(/\\/g, '\\\\')
  return singles > doubles
    ? `"${escaped.replace(/"/g, '\\"')}"`
    : `'${escaped.replace(/'/g, "\\'")}'`
}

function list(values) {
  return `[${values.map(str).join(', ')}]`
}

function inlineObject(entries) {
  return entries.length === 0 ? '{}' : `{ ${entries.map(([k, v]) => `${k}: ${v}`).join(', ')} }`
}

/** Prints `key: value` at `indent`, expanding an object value that would not fit. */
function property(indent, key, entries) {
  const inline = `${indent}${key}: ${inlineObject(entries)},`
  if (inline.length <= PRINT_WIDTH) return [inline]
  return [`${indent}${key}: {`, ...entries.map(([k, v]) => `${indent}  ${k}: ${v},`), `${indent}},`]
}

function comment(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function emitAction(action) {
  const lines = [`  // ${comment(action.label)}`, '  {']
  lines.push(`    id: ${str(action.id)},`, `    scope: ${str(action.scope)},`)
  if (action.context) lines.push(`    context: ${str(action.context)},`)
  lines.push(`    win: ${list(action.win)},`, `    mac: ${list(action.mac)},`)
  if (action.web) {
    lines.push(
      ...property('    ', 'web', [
        ['win', list(action.web.win)],
        ['mac', list(action.web.mac)],
      ]),
    )
  }
  if (action.webAlt) {
    lines.push(
      ...property(
        '    ',
        'webAlt',
        ['win', 'mac'].filter((p) => action.webAlt[p]).map((p) => [p, str(action.webAlt[p])]),
      ),
    )
  }
  lines.push(`    match: ${str(action.match)},`)
  lines.push(
    ...property(
      '    ',
      'guard',
      Object.entries(action.guard).map(([k, v]) => [k, String(v)]),
    ),
  )
  lines.push('  },')
  return lines
}

function emitEntry(entry, field) {
  const label = `    ${field}: `
  const text = `${label}${str(comment(entry[field]))},`
  return [
    '  {',
    `    id: ${str(entry.id)},`,
    `    part: ${str(entry.part)},`,
    ...(text.length <= PRINT_WIDTH
      ? [text]
      : [`    ${field}:`, `      ${text.slice(label.length)}`]),
    '  },',
  ]
}

function emitList(lines, name, type, entries, field) {
  if (entries.length === 0) {
    lines.push(`export const ${name}: readonly ${type}[] = []`)
    return
  }
  lines.push(`export const ${name}: readonly ${type}[] = [`)
  for (const entry of entries) lines.push(...emitEntry(entry, field))
  lines.push(']')
}

export const BEGIN_MARKER = '// @generated-begin'
export const END_MARKER = '// @generated-end'

export function generatedBlock(module, table) {
  const lines = [BEGIN_MARKER]
  lines.push(
    table.actions.length === 0
      ? 'const generated: readonly ShortcutAction[] = []'
      : 'const generated: readonly ShortcutAction[] = [',
  )
  if (table.actions.length > 0) {
    for (const action of table.actions) lines.push(...emitAction(action))
    lines.push(']')
  }
  lines.push('')
  emitList(lines, `${module}Unmapped`, 'UnmappedShortcut', table.unmapped, 'reason')
  lines.push('')
  emitList(lines, `${module}Notes`, 'ShortcutNote', table.notes, 'detail')
  lines.push(END_MARKER)
  return lines.join('\n')
}

function freshFile(module, block) {
  return [
    `// ${module} shortcut table. The block between the @generated markers is written`,
    '// by scripts/gen-tables.mjs from tests/fixtures/shortcuts.csv: change the CSV and',
    '// regenerate, or put hand-maintained rows in `manual` below.',
    "import { mergeRows } from '../table'",
    "import type { ShortcutAction, ShortcutNote, UnmappedShortcut } from '../types'",
    '',
    block,
    '',
    '/** Hand-maintained rows: an entry with a generated id replaces that row. */',
    'const manual: readonly ShortcutAction[] = []',
    '',
    `export const ${module}Shortcuts: readonly ShortcutAction[] = mergeRows(generated, manual)`,
    '',
  ].join('\n')
}

/** The full text of src/tables/<module>.ts, keeping what lies outside the markers. */
export function renderTableFile(module, table, existing) {
  const block = generatedBlock(module, table)
  if (!existing) return freshFile(module, block)
  const start = existing.indexOf(BEGIN_MARKER)
  const end = existing.indexOf(END_MARKER)
  if (start < 0 || end < start) throw new Error(`${module}.ts: @generated markers missing`)
  return existing.slice(0, start) + block + existing.slice(end + END_MARKER.length)
}

export function tablePath(module) {
  return join(TABLES_DIR, `${module}.ts`)
}

function main(argv) {
  const check = argv.includes('--check')
  const fromIndex = argv.indexOf('--from')
  if (fromIndex >= 0) {
    const source = resolve(argv[fromIndex + 1] ?? '')
    const rows = parseCsv(readFileSync(source, 'utf8'))
    const date = new Date().toISOString().slice(0, 10)
    writeFileSync(FIXTURE_PATH, snapshotCsv(rows, source, date))
  }
  const tables = buildTables(parseCsv(readFileSync(FIXTURE_PATH, 'utf8')))
  let stale = 0
  for (const module of MODULES) {
    const path = tablePath(module)
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : null
    const next = renderTableFile(module, tables[module], existing)
    if (next === existing) continue
    if (check) {
      console.error(`stale: src/tables/${module}.ts`)
      stale++
    } else writeFileSync(path, next)
  }
  const actions = MODULES.flatMap((m) => tables[m].actions)
  const unmappedRows = MODULES.reduce(
    (n, m) => n + tables[m].unmapped.filter((u) => u.part === 'row').length,
    0,
  )
  const covered = (pick) => actions.filter((a) => pick(a).length > 0).length
  const web = (platform) => (a) => [
    ...(a.web ?? a)[platform],
    ...(a.webAlt?.[platform] ? [a.webAlt[platform]] : []),
  ]
  console.log(`${actions.length} actions, ${unmappedRows} unmapped rows`)
  console.log(
    `with a chord: desktop win ${covered((a) => a.win)}, desktop mac ${covered((a) => a.mac)}, ` +
      `web win ${covered(web('win'))}, web mac ${covered(web('mac'))}`,
  )
  if (stale > 0) process.exit(1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
}
