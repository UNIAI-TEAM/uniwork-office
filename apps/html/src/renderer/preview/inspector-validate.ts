import type {
  ComputedSnapshot,
  ElementFingerprint,
  ElementRect,
  FromInspector,
  FromInspectorBody,
} from './inspector-protocol'

/**
 * Strict parser of the inspector's messages (the preview frame runs the document's own scripts,
 * so anything it sends may be forged). Returns a fresh object holding only the fields of the
 * message type, each checked for type and size, or null to drop the message. Nothing from the
 * input object is passed on by reference, so extra keys or prototype tricks never reach the app.
 */

/** inline edits and fingerprints are bounded: a page sending more than this is not an inspector */
const MAX_HTML = 1 << 20
const MAX_TEXT = 1 << 16
const MAX_SHORT = 4096
/** computed background images / image src can be data: URIs */
const MAX_URLISH = 8 << 20
const MAX_STYLES = 64

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length <= max ? v : undefined

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

const sid = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined

/** `undefined` = invalid; null is allowed where the protocol says so */
const sidOrNull = (v: unknown): number | null | undefined => (v === null ? null : sid(v))

function rect(v: unknown): ElementRect | undefined {
  if (!isObj(v)) return undefined
  const x = num(v.x)
  const y = num(v.y)
  const width = num(v.width)
  const height = num(v.height)
  if (x === undefined || y === undefined || width === undefined || height === undefined)
    return undefined
  return { x, y, width, height }
}

const COMPUTED_KEYS = [
  'color',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'textAlign',
  'background',
  'width',
  'height',
  'borderRadius',
  'padding',
  'opacity',
  'transform',
  'marginLeft',
  'marginRight',
  'objectFit',
] as const

function computed(v: unknown): ComputedSnapshot | undefined {
  if (!isObj(v)) return undefined
  const out: Partial<ComputedSnapshot> = {}
  for (const key of COMPUTED_KEYS) {
    const value = str(v[key], MAX_SHORT)
    if (value === undefined) return undefined
    out[key] = value
  }
  const backgroundImage = str(v.backgroundImage, MAX_URLISH)
  if (backgroundImage === undefined) return undefined
  out.backgroundImage = backgroundImage
  if (v.image !== undefined) {
    if (!isObj(v.image)) return undefined
    const src = str(v.image.src, MAX_URLISH)
    const alt = str(v.image.alt, MAX_TEXT)
    const naturalWidth = num(v.image.naturalWidth)
    const naturalHeight = num(v.image.naturalHeight)
    if (
      src === undefined ||
      alt === undefined ||
      naturalWidth === undefined ||
      naturalHeight === undefined
    )
      return undefined
    out.image = { src, alt, naturalWidth, naturalHeight }
  }
  return out as ComputedSnapshot
}

interface TextRun {
  textRun: string | null
  textRunIndex: number
  inlineEditable: boolean
}

function textRun(v: Obj): TextRun | undefined {
  const run = v.textRun === null ? null : str(v.textRun, MAX_TEXT)
  const index = num(v.textRunIndex)
  if (run === undefined || index === undefined || !Number.isInteger(index) || index < -1)
    return undefined
  if (typeof v.inlineEditable !== 'boolean') return undefined
  return { textRun: run, textRunIndex: index, inlineEditable: v.inlineEditable }
}

function fingerprint(v: unknown): ElementFingerprint | undefined {
  if (!isObj(v)) return undefined
  // a script-made element has no source location: the inspector reports sid null (dynamic)
  const id = sidOrNull(v.sid)
  const tag = str(v.tag, 64)
  const className = str(v.className, MAX_SHORT)
  const text = str(v.text, MAX_TEXT)
  const r = rect(v.rect)
  const c = computed(v.computed)
  const run = textRun(v)
  const count = num(v.childElementCount)
  if (
    id === undefined ||
    tag === undefined ||
    !/^[a-z][a-z0-9-]*$/.test(tag) ||
    className === undefined ||
    text === undefined ||
    !r ||
    !c ||
    !run ||
    count === undefined ||
    !Number.isInteger(count) ||
    count < 0
  )
    return undefined
  return {
    // typed as number in the protocol; App.tsx treats a null sid as a dynamic element
    sid: id as number,
    tag,
    className,
    childElementCount: count,
    text,
    rect: r,
    computed: c,
    ...run,
  }
}

/** CSS property -> value, as the resize / slide gestures send them */
function styles(v: unknown): Record<string, string> | undefined {
  if (!isObj(v)) return undefined
  const entries = Object.entries(v)
  if (entries.length > MAX_STYLES) return undefined
  const out: Record<string, string> = Object.create(null)
  for (const [prop, value] of entries) {
    if (!/^-{0,2}[a-z][a-z0-9-]{0,63}$/.test(prop)) return undefined
    const val = str(value, MAX_SHORT)
    if (val === undefined) return undefined
    out[prop] = val
  }
  return { ...out }
}

const KEY_COMMANDS = new Set([
  'delete',
  'parent',
  'next',
  'prev',
  'child',
  'askAi',
  'bold',
  'italic',
  'escape',
  'undo',
  'redo',
  'zoomIn',
  'zoomOut',
  'zoomReset',
  'moveUp',
  'moveDown',
])

function body(type: string, m: Obj): FromInspectorBody | undefined {
  switch (type) {
    case 'gx:ready': {
      const title = str(m.title, MAX_SHORT)
      const docHeight = num(m.docHeight)
      return title === undefined || docHeight === undefined ? undefined : { type, title, docHeight }
    }
    case 'gx:scroll': {
      const y = num(m.y)
      return y === undefined ? undefined : { type, y }
    }
    case 'gx:hover': {
      const id = sidOrNull(m.sid)
      return id === undefined ? undefined : { type, sid: id }
    }
    case 'gx:rect': {
      const id = sid(m.sid)
      const r = rect(m.rect)
      const c = computed(m.computed)
      const run = textRun(m)
      return id === undefined || !r || !c || !run
        ? undefined
        : { type, sid: id, rect: r, computed: c, ...run }
    }
    case 'gx:select': {
      if (typeof m.dynamic !== 'boolean') return undefined
      if (m.element === null) return { type, element: null, dynamic: m.dynamic }
      const element = fingerprint(m.element)
      return element ? { type, element, dynamic: m.dynamic } : undefined
    }
    case 'gx:textSelect': {
      const id = sid(m.sid)
      const index = sid(m.textNodeIndex)
      const start = sid(m.start)
      const end = sid(m.end)
      const text = str(m.text, MAX_TEXT)
      return id === undefined ||
        index === undefined ||
        start === undefined ||
        end === undefined ||
        end < start ||
        text === undefined
        ? undefined
        : { type, sid: id, textNodeIndex: index, start, end, text }
    }
    case 'gx:textEditCommit': {
      const id = sid(m.sid)
      const index = sid(m.textNodeIndex)
      const newText = str(m.newText, MAX_TEXT)
      return id === undefined || index === undefined || newText === undefined
        ? undefined
        : { type, sid: id, textNodeIndex: index, newText }
    }
    case 'gx:htmlEditCommit': {
      const id = sid(m.sid)
      const html = str(m.html, MAX_HTML)
      return id === undefined || html === undefined ? undefined : { type, sid: id, html }
    }
    case 'gx:textEditCancel':
      return { type }
    case 'gx:keyCommand':
      return typeof m.command === 'string' && KEY_COMMANDS.has(m.command)
        ? {
            type,
            command: m.command as Extract<FromInspectorBody, { type: 'gx:keyCommand' }>['command'],
          }
        : undefined
    case 'gx:zoom': {
      const delta = num(m.delta)
      return delta === undefined ? undefined : { type, delta }
    }
    case 'gx:navigateBlocked': {
      const href = str(m.href, MAX_SHORT)
      return href === undefined ? undefined : { type, href }
    }
    case 'gx:markClick': {
      const id = sid(m.sid)
      return id === undefined ? undefined : { type, sid: id }
    }
    case 'gx:resize': {
      const id = sid(m.sid)
      const s = styles(m.styles)
      return id === undefined || !s ? undefined : { type, sid: id, styles: s }
    }
    case 'gx:moveTo': {
      const id = sid(m.sid)
      const ref = sid(m.ref_sid)
      const position = m.position === 'before' || m.position === 'after' ? m.position : undefined
      return id === undefined || ref === undefined || !position
        ? undefined
        : { type, sid: id, position, ref_sid: ref }
    }
    case 'gx:drag':
      return typeof m.active === 'boolean' ? { type, active: m.active } : undefined
    default:
      return undefined
  }
}

export function parseFromInspector(data: unknown): FromInspector | null {
  if (!isObj(data) || typeof data.type !== 'string') return null
  const version = sid(data.version)
  if (version === undefined) return null
  const parsed = body(data.type, data)
  return parsed ? ({ version, ...parsed } as FromInspector) : null
}
