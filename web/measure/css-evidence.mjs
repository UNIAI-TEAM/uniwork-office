// UNI-1011 spike: evidence for the iframe-vs-mount decision, taken from the built CSS/JS.
// Usage: node web/measure/css-evidence.mjs [out.json]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const dist = resolve(repoRoot, 'web/docs/dist/assets')
const out = process.argv[2] ?? resolve(here, 'css-evidence.json')

const cssFiles = readdirSync(dist).filter((f) => f.endsWith('.css'))
const jsFiles = readdirSync(dist).filter((f) => f.endsWith('.js'))
const css = cssFiles.map((f) => readFileSync(resolve(dist, f), 'utf8')).join('\n')

// strip comments, then flatten @media/@supports blocks one level so nested rules are seen
const flat = css.replace(/\/\*[\s\S]*?\*\//g, '')
// selector lists = text before '{' (skip @-rules)
const selectorLists = []
for (const m of flat.matchAll(/([^{}@;]+)\{/g)) {
  const sel = m[1].trim()
  if (flat[m.index - 1] === '@') continue // at-rule prelude (@keyframes x / @media y), not a selector
  if (sel && !/^[\d.%\s,]+$/.test(sel) && !/^(from|to)$/.test(sel)) selectorLists.push(sel)
}
const selectors = selectorLists.flatMap((s) => s.split(',').map((x) => x.trim())).filter(Boolean)

const isRoot = (s) => /(^|[\s>+~])(:root)\b/.test(s) || s.startsWith(':root')
const isHtml = (s) => /^html\b/.test(s) || /(^|[\s,>+~])html(\b|\[|\.|:)/.test(s)
const isBody = (s) => /^body\b/.test(s) || /(^|[\s>+~])body(\b|\[|\.|:)/.test(s)
const isUniversal = (s) => /(^|[\s>+~])\*(\s|$|[:.[])/.test(s) || s === '*'
// bare element selectors (leak into a host page): first compound is a tag with no class/id
const bareTag = (s) => /^[a-z][a-z0-9]*(\s|$|[:[>+~])/.test(s) && !/^[a-z0-9]+[.#]/.test(s)
const dataTheme = (s) => /data-theme/.test(s)

const cnt = (pred) => selectors.filter(pred)
const cat = {
  ':root': cnt(isRoot),
  html: cnt((s) => isHtml(s) && !isRoot(s)),
  body: cnt(isBody),
  '*(universal)': cnt(isUniversal),
  'bare element (tag-only first compound)': cnt(bareTag),
  '[data-theme] (needs <html data-theme>)': cnt(dataTheme),
}

const fontFaces = [...flat.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
  const body = m[1]
  const family = /font-family:\s*"?([^;"]+)"?/.exec(body)?.[1].trim()
  const src = /url\(([^)]*)\)/.exec(body)?.[1].replace(/["']/g, '')
  return { family, src }
})
const families = {}
for (const f of fontFaces) families[f.family] = (families[f.family] ?? 0) + 1
const keyframes = [...flat.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])
const customProps = new Set([...flat.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
const classes = new Set([...flat.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))
const unprefixedCommon = [...classes].filter((c) => /^(app|btn|button|menu|toolbar|modal|dialog|panel|tab|tabs|icon|page|editor|container|content|header|footer|sidebar|toast|tooltip|popup|overlay|input|select|row|col|card|list|item)$/.test(c))

const js = jsFiles.map((f) => readFileSync(resolve(dist, f), 'utf8')).join('\n')
const globalsWritten = {}
for (const m of js.matchAll(/\b(?:window|globalThis)\.(__?[A-Za-z][\w$]*|[a-z][A-Za-z0-9_$]*)\s*=[^=]/g)) globalsWritten[m[1]] = (globalsWritten[m[1]] ?? 0) + 1
const globalsRead = {}
for (const m of js.matchAll(/\b(?:window|globalThis)\.(desktop|projectApi|__[A-Za-z][\w$]*)\b/g)) globalsRead[m[1]] = (globalsRead[m[1]] ?? 0) + 1
const docListeners = {
  'document.addEventListener': (js.match(/document\.addEventListener\(/g) ?? []).length,
  'window.addEventListener': (js.match(/window\.addEventListener\(/g) ?? []).length,
  'document.body.': (js.match(/document\.body\b/g) ?? []).length,
  'document.documentElement': (js.match(/document\.documentElement\b/g) ?? []).length,
  'document.head': (js.match(/document\.head\b/g) ?? []).length,
  'document.fonts': (js.match(/document\.fonts\b/g) ?? []).length,
  'localStorage': (js.match(/localStorage\b/g) ?? []).length,
  'sessionStorage': (js.match(/sessionStorage\b/g) ?? []).length,
  'indexedDB': (js.match(/indexedDB\b/g) ?? []).length,
  'navigator.clipboard': (js.match(/navigator\.clipboard/g) ?? []).length,
  'window.print': (js.match(/window\.print\(/g) ?? []).length,
  'window.open': (js.match(/window\.open\(/g) ?? []).length,
  'new Worker': (js.match(/new Worker\(/g) ?? []).length,
  'postMessage': (js.match(/postMessage\(/g) ?? []).length,
  'BroadcastChannel': (js.match(/BroadcastChannel/g) ?? []).length,
  'Konva/canvas': (js.match(/getContext\(["']2d["']/g) ?? []).length,
}

const result = {
  cssFiles,
  cssBytes: css.length,
  totalSelectors: selectors.length,
  families,
  fontFaceCount: fontFaces.length,
  keyframes,
  customPropertyCount: customProps.size,
  classCount: classes.size,
  genericUnprefixedClassNames: unprefixedCommon,
  globalSelectors: Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, { count: v.length, samples: [...new Set(v)].slice(0, 12) }])),
  windowGlobalsWritten: globalsWritten,
  windowGlobalsRead: globalsRead,
  browserApiUsage: docListeners,
}
writeFileSync(out, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
