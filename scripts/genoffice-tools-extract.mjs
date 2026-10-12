#!/usr/bin/env node
/**
 * genoffice-tools-extract v1 — deterministic, read-only extractor for the
 * genoffice agent tool table (G6-01 / UNI-1363, lane g6-fork_tools).
 *
 *   node scripts/genoffice-tools-extract.mjs [--rev <git-rev>] [--repo <dir>]
 *
 * Defaults: --rev HEAD, --repo = the git toplevel of the current directory.
 * Every file is read through git (`git ls-tree`, `git show <rev>:<path>`) at the
 * given revision: nothing is checked out, no product code is executed, and the
 * process never touches the network. Exit 0 on success; non-zero with a message
 * on a bad rev or an unusable repo.
 *
 * Dependencies: none. The sources are parsed with the small literal evaluator in
 * this file (strings / numbers / objects / arrays / spreads / template
 * interpolations / a few array methods), so the script runs after a plain
 * `npm ci` and even before one. It deliberately does not import `typescript`:
 * the tool definitions are data-shaped, and a full type-aware pass would need
 * the repo's `node_modules` (absent on a fresh clone) for no extra accuracy.
 *
 * ── What counts as a tool ────────────────────────────────────────────────────
 * An object literal with `name` (a string literal), `description` and
 * `inputSchema`, anywhere under `packages/agent-core/src/**` or
 * `apps/<app>/src/renderer/ai/**` at the rev. That covers tools declared inline
 * in a list, in helper files, spread into a list from a shared `const`, and
 * tools reached only through a capability-keyed `get tools()` getter (the
 * getter itself is not evaluated — the object literal is the definition).
 *
 * A tool-shaped object with `name` + `description` but no `inputSchema` is also
 * found through a second, deliberately narrow `name` anchor: the object must be
 * an element of a tools-list array literal. A tools list is written in one of
 * three forms: an annotated binding (`AgentToolDef[]`, `readonly AgentToolDef[]`,
 * `Array<AgentToolDef> = [`), a `tools: [ ... ]` field outside a schema bag, or
 * a `return [ ... ]` at a `get tools()` accessor body's own brace level (the
 * head may carry a return-type annotation, `get tools(): AgentToolDef[]`).
 * `AgentToolDef` (or the bare `AgentTool`) is matched exactly, so an
 * `AgentToolCall[]` / `AgentToolResult[]` array — whose records carry `name`
 * too — is not a tools list. An unannotated array, one typed as anything else
 * (an option list, a typed command list), a nested `options:` bag, a `tools`
 * bag in a schema, a `get options()` returned literal or a plain helper's
 * `return [ ... ]` contributes no row, so a non-tool `{ name, description }`
 * array cannot manufacture phantom rows.
 *
 * module = `agent-core`, or the app directory name (`docs`, `sheets`, `slides`,
 * `pdf`, `markdown`, `html`). source = repo-relative path of the defining file.
 * Rows are sorted by module, then tool name, then source (code-unit order);
 * a duplicate (module, tool) pair keeps both rows.
 *
 * ── input_schema_sha256 ──────────────────────────────────────────────────────
 * sha256 (lower-case hex) of the canonical JSON of the statically resolved
 * `inputSchema`: object keys sorted recursively, no whitespace, array order
 * kept. A schema that cannot be resolved statically is never guessed: the cell
 * is `unresolved:<reason>`.
 *
 * `unresolved:<reason>` reasons (the first unresolved node in source order wins):
 *   missing                     no `inputSchema` property on the definition
 *   identifier:<name>           a bare identifier with no const/import binding
 *                               in this file, its imports, or a resolved module
 *   module:<spec>               an import specifier that does not resolve to a
 *                               file in the repo at this rev
 *   member:<name>               property access on a resolved value that lacks it
 *   call:<name>                 a method the evaluator does not implement
 *   operator                    an operator outside the supported subset
 *   computed-key                a computed `[expr]` object key
 *   method                      an object method shorthand (`f() {}`)
 *
 * ── editor_write ─────────────────────────────────────────────────────────────
 * `yes` / `no` / `undeclared`, from declarations in the module's own sources
 * only (never inferred from behaviour). Two routing styles are followed, each
 * bounded to the region that actually runs for the named tool:
 *   1. `switch (call.name)` cases — the `mutated:` declarations inside the case
 *      body, plus those inside local helpers that body calls.
 *   2. `if (call.name === 'x')` / `if (call.name !== 'x')` guards (the skill
 *      files route with an equality test). Only the guard's own consequent is
 *      read for `===` (the branch the named tool takes); for `!==` the
 *      enclosing body minus that consequent is read (the tool's own
 *      fall-through path), so a `mutated: false` declared after an early-return
 *      guard still counts. A braceless consequent is one statement, and its
 *      extent is that statement's own: it runs through an open call, object,
 *      array or template and through a trailing operator, and takes a nested
 *      if/else/for/while consequent (with the `else` that binds to it) with it,
 *      up to the `;` that closes it, the enclosing block's `}`, or the line
 *      break where ASI ends it — never on into the next `;`/`}` or the `switch`
 *      below. `return` is a restricted production: a line break after it ends
 *      the statement, so a `(`/`[` on the next line is not part of the branch.
 *      A `call.name === 'x'` anywhere else (a ternary, a `const`, an argument)
 *      controls no path and contributes nothing.
 * A local helper is resolved by declaration position and lexical scope, not by
 * bare name, so same-named closures in different cases stay distinct. The
 * recursion never enters a helper that is itself a dispatcher — the shared
 * `executeTool` / `executeSyncTool` executors — which would otherwise leak
 * another tool's flag into the calling tool. A helper counts as a dispatcher
 * only when it really branches on `call.name`: a `switch (call.name)`, or a
 * `call.name ===/!==/==/!= '...'` comparison that is an `if` condition. A
 * comparison that only picks a value (a ternary, a `const`, an argument)
 * controls no path, so a mutating helper that mentions `call.name` that way is
 * still followed and its `mutated: true` still reaches the calling tool.
 *   yes          the reached region returns a ToolExecution with
 *                `mutated: true`, or a computed `mutated:` expression
 *                (e.g. `mutated: changed > 0`) — the code declares a mutation
 *   no           the reached region declares only `mutated: false` for the
 *                tool, or the tool is a member of a declared read-only
 *                allowlist (`READ_ONLY_TOOLS` / `VIEW_ONLY_TOOLS`) in the same
 *                module
 *   undeclared   neither: no `mutated` declaration is reached for the tool and
 *                no read-only marker names it
 *
 * A tool-shaped object literal that carries `name` and `description` but no
 * `inputSchema` still gets a row; its schema cell is `unresolved:missing` (a
 * silent drop would hide a tool from the table).
 */

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'

const USAGE = 'usage: node scripts/genoffice-tools-extract.mjs [--rev <git-rev>] [--repo <dir>]'

/** module → the two source roots the table covers */
const SCAN_ROOTS = [
  { module: 'agent-core', re: /^packages\/agent-core\/src\/.*\.tsx?$/ },
  { module: null, re: /^apps\/([^/]+)\/src\/renderer\/ai\/.*\.tsx?$/ },
]

// ──────────────────────────────── git access ────────────────────────────────

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function gitTry(repo, args) {
  try {
    return git(repo, args)
  } catch {
    return null
  }
}

function readAt(repo, rev, path, cache) {
  const key = `${rev}\u0000${path}`
  if (!cache.has(key)) cache.set(key, gitTry(repo, ['show', `${rev}:${path}`]))
  return cache.get(key)
}

// ──────────────────────────────── tokenizer ────────────────────────────────

const REGEX_OK_AFTER_KEYWORD = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'do',
  'else',
  'case',
  'yield',
  'await',
  'throw',
])

const MULTI_PUNCT = [
  '...',
  '=>',
  '===',
  '!==',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '?.',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '**',
]
const SINGLE_PUNCT = '{}[](),:;.=?+-*/%<>!&|^~'

function readString(src, i) {
  const quote = src[i]
  let out = ''
  let j = i + 1
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') {
      const [ch, next] = decodeEscape(src, j)
      out += ch
      j = next
      continue
    }
    if (c === quote) return [out, j + 1]
    out += c
    j += 1
  }
  return [out, j]
}

/** decode one escape sequence starting at the backslash; returns [text, nextIndex] */
function decodeEscape(src, i) {
  const c = src[i + 1]
  switch (c) {
    case 'n':
      return ['\n', i + 2]
    case 'r':
      return ['\r', i + 2]
    case 't':
      return ['\t', i + 2]
    case 'b':
      return ['\b', i + 2]
    case 'f':
      return ['\f', i + 2]
    case 'v':
      return ['\v', i + 2]
    case '0':
      return ['\0', i + 2]
    case 'x': {
      const hex = src.slice(i + 2, i + 4)
      const code = Number.parseInt(hex, 16)
      return [Number.isNaN(code) ? `\\x${hex}` : String.fromCharCode(code), i + 4]
    }
    case 'u': {
      if (src[i + 2] === '{') {
        const end = src.indexOf('}', i + 3)
        if (end !== -1) {
          const code = Number.parseInt(src.slice(i + 3, end), 16)
          return [Number.isNaN(code) ? src.slice(i, end + 1) : String.fromCodePoint(code), end + 1]
        }
      }
      const hex = src.slice(i + 2, i + 6)
      const code = Number.parseInt(hex, 16)
      return [Number.isNaN(code) ? `\\u${hex}` : String.fromCharCode(code), i + 6]
    }
    case '\n':
      return ['', i + 2]
    default:
      return [c === undefined ? '' : c, i + 2]
  }
}

/** index just past a template literal that starts at the backtick */
function readTemplate(src, i) {
  let j = i + 1
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === '`') return j + 1
    if (c === '$' && src[j + 1] === '{') {
      j = skipBraced(src, j + 1)
      continue
    }
    j += 1
  }
  return j
}

/** index just past the `}` matching the `{` at openIdx (template interpolation) */
function skipBraced(src, openIdx) {
  let j = openIdx + 1
  let depth = 1
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === "'" || c === '"') {
      j = readString(src, j)[1]
      continue
    }
    if (c === '`') {
      j = readTemplate(src, j)
      continue
    }
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return j + 1
    }
    j += 1
  }
  return j
}

/** regex literal, or null when this `/` is division (never spans a line) */
function readRegex(src, i) {
  let j = i + 1
  let inClass = false
  while (j < src.length) {
    const c = src[j]
    if (c === '\n') return null
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (c === '/' && !inClass) {
      j += 1
      while (j < src.length && /[a-z]/.test(src[j])) j += 1
      return j
    }
    j += 1
  }
  return null
}

const NUMBER_RE =
  /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:[0-9][0-9_]*)?\.[0-9][0-9_]*(?:[eE][+-]?[0-9]+)?|[0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:[eE][+-]?[0-9]+)?)/

function tokenize(src) {
  const tokens = []
  let i = 0
  let last = null
  const push = (t) => {
    tokens.push(t)
    last = t
  }
  const regexAllowed = () => {
    if (!last) return true
    if (last.type === 'ident') return REGEX_OK_AFTER_KEYWORD.has(last.value)
    if (
      last.type === 'string' ||
      last.type === 'number' ||
      last.type === 'template' ||
      last.type === 'regex'
    )
      return false
    return ![')', ']', '}'].includes(last.value)
  }
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\v') {
      i += 1
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (c === "'" || c === '"') {
      const [value, end] = readString(src, i)
      push({ type: 'string', value, start: i, end })
      i = end
      continue
    }
    if (c === '`') {
      const end = readTemplate(src, i)
      push({ type: 'template', raw: src.slice(i, end), start: i, end })
      i = end
      continue
    }
    if (c === '/' && regexAllowed()) {
      const end = readRegex(src, i)
      if (end !== null) {
        push({ type: 'regex', raw: src.slice(i, end), start: i, end })
        i = end
        continue
      }
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j += 1
      push({ type: 'ident', value: src.slice(i, j), start: i, end: j })
      i = j
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = NUMBER_RE.exec(src.slice(i))
      const raw = m ? m[0] : c
      push({ type: 'number', value: Number(raw.replace(/_/g, '')), start: i, end: i + raw.length })
      i += raw.length
      continue
    }
    let matched = null
    for (const p of MULTI_PUNCT) {
      if (src.startsWith(p, i)) {
        matched = p
        break
      }
    }
    if (matched) {
      push({ type: 'punct', value: matched, start: i, end: i + matched.length })
      i += matched.length
      continue
    }
    if (SINGLE_PUNCT.includes(c)) {
      push({ type: 'punct', value: c, start: i, end: i + 1 })
      i += 1
      continue
    }
    // anything else (JSX text, stray characters): skip one char, do not disturb `last`
    i += 1
  }
  return tokens
}

// ─────────────────────────── literal evaluator ───────────────────────────

const U = (reason) => ({ __unresolved: reason })
const isU = (v) =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.__unresolved === 'string'
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && !isU(v)

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function findUnresolved(value) {
  if (isU(value)) return value.__unresolved
  if (Array.isArray(value)) {
    for (const v of value) {
      const r = findUnresolved(v)
      if (r) return r
    }
    return null
  }
  if (isPlainObject(value)) {
    for (const k of Object.keys(value)) {
      const r = findUnresolved(value[k])
      if (r) return r
    }
  }
  return null
}

function canonicalJson(value) {
  if (value === null) return 'null'
  const t = typeof value
  if (t === 'boolean' || t === 'number') return JSON.stringify(value)
  if (t === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (t === 'object') {
    const keys = Object.keys(value).sort(cmp)
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
  }
  return 'null'
}

/** parser state: tokens + the file scope used to resolve identifiers */
function parseExpression(tokens, i, scope, depth = 0) {
  if (depth > 24) return { value: U('recursion'), i }
  const primary = parsePrimary(tokens, i, scope, depth)
  return parsePostfix(primary.value, tokens, primary.i, scope, depth)
}

function parsePrimary(tokens, i, scope, depth) {
  const tk = tokens[i]
  if (!tk) return { value: U('missing'), i }
  if (tk.type === 'string') return { value: tk.value, i: i + 1 }
  if (tk.type === 'number') return { value: tk.value, i: i + 1 }
  if (tk.type === 'template') {
    const r = parseTemplateToken(tk.raw, scope, depth)
    return { value: r.value, i: i + 1 }
  }
  if (tk.type === 'regex') return { value: U('regex-literal'), i: i + 1 }
  if (tk.type === 'punct') {
    if (tk.value === '{') return parseObject(tokens, i, scope, depth)
    if (tk.value === '[') return parseArray(tokens, i, scope, depth)
    if (tk.value === '(') {
      const inner = parseExpression(tokens, i + 1, scope, depth + 1)
      const close = tokens[inner.i]
      return { value: inner.value, i: close && close.value === ')' ? inner.i + 1 : inner.i }
    }
    if (tk.value === '-') {
      const inner = parsePrimary(tokens, i + 1, scope, depth + 1)
      if (typeof inner.value === 'number') return { value: -inner.value, i: inner.i }
      return { value: U('operator'), i: inner.i }
    }
    if (tk.value === '!') {
      const inner = parsePrimary(tokens, i + 1, scope, depth + 1)
      if (typeof inner.value === 'boolean') return { value: !inner.value, i: inner.i }
      return { value: U('operator'), i: inner.i }
    }
    return { value: U('operator'), i: i + 1 }
  }
  // identifier
  const name = tk.value
  if (name === 'true') return { value: true, i: i + 1 }
  if (name === 'false') return { value: false, i: i + 1 }
  if (name === 'null') return { value: null, i: i + 1 }
  if (name === 'undefined') return { value: U('identifier:undefined'), i: i + 1 }
  if (name === 'new') {
    // `new Set([...])` / `new Map()` — only the first argument is meaningful here
    const ctor = tokens[i + 1]
    if (ctor && ctor.type === 'ident' && tokens[i + 2] && tokens[i + 2].value === '(') {
      const arg = parseExpression(tokens, i + 3, scope, depth + 1)
      return { value: arg.value, i: arg.i }
    }
    return { value: U('identifier:new'), i: i + 2 }
  }
  return resolveName(name, tokens, i, scope, depth)
}

function parsePostfix(value, tokens, i, scope, depth) {
  let cur = value
  let idx = i
  for (;;) {
    const tk = tokens[idx]
    if (!tk) return { value: cur, i: idx }
    if (tk.type === 'ident' && (tk.value === 'as' || tk.value === 'satisfies')) {
      idx = skipType(tokens, idx + 1)
      continue
    }
    if (tk.type === 'punct' && tk.value === '.') {
      const key = tokens[idx + 1]
      if (!key || key.type !== 'ident') return { value: U('member'), i: idx + 1 }
      // a member call (`xs.map(f)`) resolves against the receiver, not a property
      if (tokens[idx + 2] && tokens[idx + 2].value === '(') {
        const call = parseCall(cur, key.value, tokens, idx + 2, scope, depth)
        cur = call.value
        idx = call.i
        continue
      }
      cur = memberOf(cur, key.value)
      idx += 2
      continue
    }
    if (tk.type === 'punct' && tk.value === '[') {
      const inner = parseExpression(tokens, idx + 1, scope, depth + 1)
      const close = tokens[inner.i]
      idx = close && close.value === ']' ? inner.i + 1 : inner.i
      if (Array.isArray(cur) && typeof inner.value === 'number') cur = cur[inner.value]
      else if (typeof inner.value === 'string') cur = memberOf(cur, inner.value)
      else cur = U('computed-key')
      continue
    }
    if (tk.type === 'punct' && tk.value === '(') {
      const call = parseCall(cur, null, tokens, idx, scope, depth)
      cur = call.value
      idx = call.i
      continue
    }
    return { value: cur, i: idx }
  }
}

function skipType(tokens, i) {
  let depth = 0
  let idx = i
  while (idx < tokens.length) {
    const tk = tokens[idx]
    if (tk.type === 'punct') {
      if (tk.value === '<' || tk.value === '(' || tk.value === '[' || tk.value === '{') depth += 1
      else if (tk.value === '>' || tk.value === ')' || tk.value === ']' || tk.value === '}') {
        if (depth === 0) break
        depth -= 1
      } else if (
        depth === 0 &&
        (tk.value === ',' ||
          tk.value === ';' ||
          tk.value === '=' ||
          tk.value === '?' ||
          tk.value === ':' ||
          tk.value === '=>')
      )
        break
    }
    idx += 1
  }
  return idx
}

function memberOf(value, key) {
  if (isU(value)) return value
  if (key === 'length' && (Array.isArray(value) || typeof value === 'string')) return value.length
  if (isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, key)) return value[key]
  return U(`member:${key}`)
}

function parseCall(callee, methodName, tokens, i, scope, depth) {
  const name = methodName
  const args = []
  let idx = i + 1
  for (;;) {
    const tk = tokens[idx]
    if (!tk || tk.value === ')') {
      idx = tk ? idx + 1 : idx
      break
    }
    if (tk.value === ',') {
      idx += 1
      continue
    }
    const r = parseExpression(tokens, idx, scope, depth + 1)
    args.push(r.value)
    idx = r.i
    if (tokens[idx] && tokens[idx].value === ',') continue
    if (tokens[idx] && tokens[idx].value === ')') {
      idx += 1
      break
    }
    break
  }
  return { value: applyCall(callee, name, args, tokens, i, scope, depth), i: idx }
}

function applyCall(callee, name, args, tokens, openParen, scope, depth) {
  if (isU(callee)) return callee
  if (name === 'join') {
    if (!Array.isArray(callee)) return U('call:join')
    const sep = typeof args[0] === 'string' ? args[0] : ','
    return callee.map((v) => (isU(v) ? '' : String(v))).join(sep)
  }
  if (name === 'slice') {
    if (Array.isArray(callee) || typeof callee === 'string') {
      const a = typeof args[0] === 'number' ? args[0] : 0
      const b = typeof args[1] === 'number' ? args[1] : undefined
      return callee.slice(a, b)
    }
    return U('call:slice')
  }
  if (name === 'concat') {
    if (!Array.isArray(callee)) return U('call:concat')
    let out = callee.slice()
    for (const a of args) {
      if (isU(a)) return a
      out = out.concat(a)
    }
    return out
  }
  if (name === 'map' || name === 'filter') {
    if (!Array.isArray(callee)) return U(`call:${name}`)
    const fn = parseArrowAt(tokens, openParen + 1)
    if (!fn) return U(`call:${name}`)
    const out = []
    for (const item of callee) {
      const bound = new Map(scope.bindings)
      bound.set(fn.param, item)
      const body = parseExpression(tokens, fn.body, { ...scope, bindings: bound }, depth + 1)
      if (isU(body.value)) return body.value
      if (name === 'filter') {
        if (body.value) out.push(item)
      } else out.push(body.value)
    }
    return out
  }
  return U(`call:${name || 'unknown'}`)
}

/** `(p) => expr` / `p => expr` starting at token index i */
function parseArrowAt(tokens, i) {
  let idx = i
  let param
  if (tokens[idx] && tokens[idx].value === '(') {
    if (
      tokens[idx + 1] &&
      tokens[idx + 1].type === 'ident' &&
      tokens[idx + 2] &&
      tokens[idx + 2].value === ')'
    ) {
      param = tokens[idx + 1].value
      idx += 3
    } else return null
  } else if (tokens[idx] && tokens[idx].type === 'ident') {
    param = tokens[idx].value
    idx += 1
  } else return null
  if (!tokens[idx] || tokens[idx].value !== '=>') return null
  idx += 1
  if (tokens[idx] && tokens[idx].value === '{') return null
  return { param, body: idx }
}

function parseObject(tokens, i, scope, depth) {
  const out = {}
  let idx = i + 1
  let unresolved = null
  for (;;) {
    const tk = tokens[idx]
    if (!tk) break
    if (tk.value === '}') {
      idx += 1
      break
    }
    if (tk.value === ',') {
      idx += 1
      continue
    }
    if (tk.value === '...') {
      const spread = parseExpression(tokens, idx + 1, scope, depth + 1)
      idx = spread.i
      const bad = isU(spread.value) ? spread.value : findUnresolved(spread.value)
      if (bad) {
        unresolved = unresolved || (isU(spread.value) ? spread.value.__unresolved : bad)
      } else if (isPlainObject(spread.value)) {
        Object.assign(out, spread.value)
      } else {
        unresolved = unresolved || 'spread'
      }
      continue
    }
    if (tk.value === '[') {
      const key = parseExpression(tokens, idx + 1, scope, depth + 1)
      const close = tokens[key.i]
      idx = close && close.value === ']' ? key.i + 1 : key.i
      if (tokens[idx] && tokens[idx].value === ':') {
        const val = parseExpression(tokens, idx + 1, scope, depth + 1)
        idx = val.i
        if (typeof key.value === 'string') out[key.value] = val.value
        else unresolved = unresolved || 'computed-key'
      }
      continue
    }
    let key
    if (tk.type === 'ident' || tk.type === 'string' || tk.type === 'number') {
      key = String(tk.value)
      idx += 1
    } else if (tk.type === 'punct' && tk.value === '}') {
      idx += 1
      break
    } else {
      // unknown shape: skip one token to make progress
      idx += 1
      continue
    }
    const next = tokens[idx]
    if (next && next.value === ':') {
      const val = parseExpression(tokens, idx + 1, scope, depth + 1)
      out[key] = val.value
      idx = val.i
      continue
    }
    if (next && next.value === '(') {
      // method shorthand: not a data property
      const close = skipBalanced(tokens, idx)
      out[key] = U('method')
      idx = close
      continue
    }
    if (next && (next.value === ',' || next.value === '}')) {
      const resolved = resolveName(key, tokens, idx, scope, depth + 1)
      out[key] = resolved.value
      idx = resolved.i
      continue
    }
    idx += 1
  }
  return { value: unresolved ? U(unresolved) : out, i: idx }
}

/** index just past the `)` matching the `(` at openIdx */
function skipBalanced(tokens, openIdx) {
  let depth = 0
  let idx = openIdx
  while (idx < tokens.length) {
    const tk = tokens[idx]
    if (tk.value === '(') depth += 1
    else if (tk.value === ')') {
      depth -= 1
      if (depth === 0) return idx + 1
    }
    idx += 1
  }
  return idx
}

function parseArray(tokens, i, scope, depth) {
  const out = []
  let idx = i + 1
  let unresolved = null
  for (;;) {
    const tk = tokens[idx]
    if (!tk) break
    if (tk.value === ']') {
      idx += 1
      break
    }
    if (tk.value === ',') {
      idx += 1
      continue
    }
    if (tk.value === '...') {
      const spread = parseExpression(tokens, idx + 1, scope, depth + 1)
      idx = spread.i
      const bad = isU(spread.value) ? spread.value : findUnresolved(spread.value)
      if (bad) {
        unresolved = unresolved || (isU(spread.value) ? spread.value.__unresolved : bad)
      } else if (Array.isArray(spread.value)) {
        out.push(...spread.value)
      } else {
        unresolved = unresolved || 'spread'
      }
      continue
    }
    const r = parseExpression(tokens, idx, scope, depth + 1)
    out.push(r.value)
    idx = r.i
  }
  return { value: unresolved ? U(unresolved) : out, i: idx }
}

function parseTemplateToken(raw, scope, depth) {
  let out = ''
  let i = 1
  while (i < raw.length) {
    const c = raw[i]
    if (c === '\\') {
      const [text, next] = decodeEscape(raw, i)
      out += text
      i = next
      continue
    }
    if (c === '`') break
    if (c === '$' && raw[i + 1] === '{') {
      const end = skipBraced(raw, i + 1)
      const inner = raw.slice(i + 2, end - 1)
      const value = parseSubExpression(inner, scope, depth + 1)
      if (isU(value)) return { value, i: i }
      out += String(value)
      i = end
      continue
    }
    out += c
    i += 1
  }
  return { value: out, i: 0 }
}

function parseSubExpression(text, scope, depth) {
  const tokens = tokenize(text)
  const r = parseExpression(tokens, 0, scope, depth + 1)
  const bad = isU(r.value) ? r.value : findUnresolved(r.value)
  if (bad) return isU(r.value) ? r.value : U(bad)
  return r.value
}

function resolveName(name, tokens, at, scope, depth) {
  if (scope.bindings && scope.bindings.has(name))
    return { value: scope.bindings.get(name), i: at + 1 }
  const local = scope.locals.get(name)
  if (local !== undefined) {
    const r = parseExpression(local.tokens, local.index, scope, depth + 1)
    return { value: r.value, i: at + 1 }
  }
  const imp = scope.imports.get(name)
  if (imp) {
    const value = resolveExport(imp, depth + 1, scope.ctx)
    return { value, i: at + 1 }
  }
  return { value: U(`identifier:${name}`), i: at + 1 }
}

// ──────────────────────────── file analysis ────────────────────────────

const analysisCache = new Map()

function analyzeFile(repo, rev, path, ctx) {
  const key = `${rev}\u0000${path}`
  if (analysisCache.has(key)) return analysisCache.get(key)
  const src = readAt(repo, rev, path, ctx.fileCache)
  const analysis =
    src === null
      ? {
          path,
          src: null,
          tokens: [],
          locals: new Map(),
          imports: new Map(),
          exports: new Map(),
          functions: [],
        }
      : scanFile(path, src, ctx)
  analysisCache.set(key, analysis)
  return analysis
}

function scanFile(path, src, ctx) {
  const tokens = tokenize(src)
  const locals = new Map()
  const imports = new Map()
  const exports = new Map()
  const functions = []
  let brace = 0
  let paren = 0
  let bracket = 0
  for (let i = 0; i < tokens.length; i += 1) {
    const tk = tokens[i]
    if (tk.type === 'punct') {
      if (tk.value === '{') brace += 1
      else if (tk.value === '}') brace -= 1
      else if (tk.value === '(') paren += 1
      else if (tk.value === ')') paren -= 1
      else if (tk.value === '[') bracket += 1
      else if (tk.value === ']') bracket -= 1
      continue
    }
    if (tk.type !== 'ident') continue
    // helpers may be declared inside a factory function (`createDocsSkill`), so
    // declarations are collected at any depth; imports/exports are top level
    if (tk.value === 'const' || tk.value === 'let' || tk.value === 'var') {
      const decl = scanDeclaration(tokens, i)
      if (decl) {
        const fn = arrowFunctionBody(tokens, decl.index)
        // keyed by declaration position, not by bare name: same-named closures in
        // different case bodies are distinct declarations
        if (fn)
          functions.push({
            name: decl.name,
            tokens,
            start: fn.start,
            end: fn.end,
            declStart: i,
            hoisted: false,
          })
        if (brace === 0 && paren === 0 && bracket === 0) locals.set(decl.name, decl)
      }
      continue
    }
    if (tk.value === 'function') {
      const name = tokens[i + 1]
      if (!name || name.type !== 'ident') continue
      // skip the parameter list first: a destructured parameter carries its own
      // `{ ... }` type/pattern, which is not the function body
      let open = i + 2
      while (open < tokens.length && tokens[open].value !== '(') open += 1
      if (open < tokens.length) open = skipBalanced(tokens, open)
      while (open < tokens.length && tokens[open].value !== '{' && tokens[open].value !== ';')
        open += 1
      if (open < tokens.length && tokens[open].value === '{') {
        functions.push({
          name: name.value,
          tokens,
          start: open,
          end: skipBraces(tokens, open),
          declStart: i,
          hoisted: true,
        })
      }
      continue
    }
    if (brace !== 0 || paren !== 0 || bracket !== 0) continue
    if (tk.value === 'import') {
      i = scanImport(tokens, i, path, imports, ctx) - 1
      continue
    }
    if (tk.value === 'export') {
      const next = tokens[i + 1]
      if (
        next &&
        next.type === 'ident' &&
        (next.value === 'const' || next.value === 'let' || next.value === 'var')
      ) {
        const decl = scanDeclaration(tokens, i + 1)
        if (decl) {
          locals.set(decl.name, decl)
          exports.set(decl.name, decl)
          const fn = arrowFunctionBody(tokens, decl.index)
          if (fn)
            functions.push({
              name: decl.name,
              tokens,
              start: fn.start,
              end: fn.end,
              declStart: i,
              hoisted: false,
            })
        }
        continue
      }
      if (next && next.value === '{') {
        const end = skipBraces(tokens, i + 1)
        const fromIdx = end
        if (
          tokens[fromIdx] &&
          tokens[fromIdx].type === 'ident' &&
          tokens[fromIdx].value === 'from'
        ) {
          const spec = tokens[fromIdx + 1]
          if (spec && spec.type === 'string') {
            for (let k = i + 2; k < end - 1; k += 1) {
              const name = tokens[k]
              if (name.type !== 'ident') continue
              const asIdx = k + 1
              let exportedName = name.value
              if (tokens[asIdx] && tokens[asIdx].value === 'as' && tokens[asIdx + 1]) {
                exportedName = tokens[asIdx + 1].value
              }
              exports.set(exportedName, {
                reexport: { file: path, spec: spec.value, name: name.value },
              })
            }
          }
        }
        i = end - 1
        continue
      }
      continue
    }
  }
  return { path, src, tokens, locals, imports, exports, functions }
}

/** index just past a `<...>` group starting at openIdx (generic args / type params) */
function skipAngles(tokens, openIdx) {
  let depth = 0
  let idx = openIdx
  while (idx < tokens.length) {
    const tk = tokens[idx]
    if (tk.value === '<') depth += 1
    else if (tk.value === '>') {
      depth -= 1
      if (depth === 0) return idx + 1
    } else if (tk.value === ';') return idx
    idx += 1
  }
  return idx
}

/**
 * `(a, b) => { ... }` body starting at the expression index; null for other
 * shapes. A typed arrow carries a return annotation between the parameter list
 * and the `=>` (`async (x): Promise<T> => {`), so generics are skipped too.
 */
function arrowFunctionBody(tokens, index) {
  let idx = index
  if (tokens[idx] && tokens[idx].value === '(') idx = skipBalanced(tokens, idx)
  else if (tokens[idx] && tokens[idx].type === 'ident') idx += 1
  else return null
  let guard = 0
  while (idx < tokens.length && guard < 200) {
    guard += 1
    const tk = tokens[idx]
    if (tk.value === '=>') break
    if (tk.value === '<') {
      idx = skipAngles(tokens, idx)
      continue
    }
    if (tk.value === ';' || tk.value === '=' || tk.value === '{') return null
    idx += 1
  }
  if (!(tokens[idx] && tokens[idx].value === '=>')) return null
  idx += 1
  if (tokens[idx] && tokens[idx].value === '{') {
    return { tokens, start: idx, end: skipBraces(tokens, idx) }
  }
  return null
}

/** `const NAME[: type] = <init>` starting at the `const` token; returns {name, tokens, index, scope} */
function scanDeclaration(tokens, i) {
  const name = tokens[i + 1]
  if (!name || name.type !== 'ident') return null
  let idx = i + 2
  let depth = 0
  while (idx < tokens.length) {
    const tk = tokens[idx]
    if (tk.type === 'punct') {
      if (tk.value === '{' || tk.value === '(' || tk.value === '[' || tk.value === '<') depth += 1
      else if (tk.value === '}' || tk.value === ')' || tk.value === ']' || tk.value === '>')
        depth -= 1
      else if (depth <= 0 && tk.value === '=') {
        return { name: name.value, tokens, index: idx + 1 }
      } else if (depth <= 0 && tk.value === ';') return null
    }
    idx += 1
  }
  return null
}

function skipBraces(tokens, openIdx) {
  let depth = 0
  let idx = openIdx
  while (idx < tokens.length) {
    const tk = tokens[idx]
    if (tk.value === '{') depth += 1
    else if (tk.value === '}') {
      depth -= 1
      if (depth === 0) return idx + 1
    }
    idx += 1
  }
  return idx
}

/** records named/default/namespace imports; returns the index after the statement */
function scanImport(tokens, i, path, imports, _ctx) {
  let idx = i + 1
  // `import type { ... }` — type-only, no runtime value
  if (tokens[idx] && tokens[idx].type === 'ident' && tokens[idx].value === 'type') {
    while (idx < tokens.length && tokens[idx].value !== ';' && !(tokens[idx].type === 'string'))
      idx += 1
    return idx + 1
  }
  const spec = (() => {
    for (let k = idx; k < tokens.length; k += 1) {
      const tk = tokens[k]
      if (tk.type === 'string') return { value: tk.value, at: k }
      if (tk.type === 'punct' && tk.value === ';') return null
    }
    return null
  })()
  if (!spec) return idx
  const fromIdx = spec.at - 1
  const clause = tokens.slice(
    idx,
    tokens[fromIdx] && tokens[fromIdx].value === 'from' ? fromIdx : spec.at,
  )
  for (let k = 0; k < clause.length; k += 1) {
    const tk = clause[k]
    if (tk.type !== 'ident') continue
    if (tk.value === 'as' && clause[k + 1]) continue
    const prev = clause[k - 1]
    if (prev && prev.value === 'as') continue
    if (prev && prev.value === '*') {
      imports.set(tk.value, { namespace: spec.value, file: path })
      continue
    }
    const next = clause[k + 1]
    if (next && next.value === 'as' && clause[k + 2]) {
      imports.set(clause[k + 2].value, { spec: spec.value, name: tk.value, file: path })
      continue
    }
    imports.set(tk.value, { spec: spec.value, name: tk.value, file: path })
  }
  return spec.at + 1
}

function resolveExport(imp, depth, ctx) {
  if (!ctx) return U(`identifier:${imp.name}`)
  const target = ctx.resolveModule(imp.file, imp.spec)
  if (!target) return U(`module:${imp.spec}`)
  const analysis = analyzeFile(ctx.repo, ctx.rev, target, ctx)
  const found = analysis.exports.get(imp.name)
  if (!found) return U(`identifier:${imp.name}`)
  if (found.reexport) {
    if (depth > 12) return U('recursion')
    return resolveExport({ ...found.reexport, file: target }, depth + 1, ctx)
  }
  const r = parseExpression(
    found.tokens,
    found.index,
    {
      file: target,
      locals: analysis.locals,
      imports: analysis.imports,
      bindings: new Map(),
      ctx,
    },
    depth + 1,
  )
  return r.value
}

// ─────────────────────────── editor_write derivation ───────────────────────────

const MUTATED_LITERAL = new Set(['true', 'false'])

const MUTATED_RANK = { no: 0, computed: 1, yes: 2 }

/** tokens[i..i+2] spell `call.name` */
function atCallName(tokens, i) {
  return (
    !!tokens[i] &&
    tokens[i].type === 'ident' &&
    tokens[i].value === 'call' &&
    !!tokens[i + 1] &&
    tokens[i + 1].value === '.' &&
    !!tokens[i + 2] &&
    tokens[i + 2].value === 'name'
  )
}

/** the `mutated:` flags declared directly in a token range; 'yes'|'no'|'computed'|null */
function declaredMutated(tokens, from, to) {
  let mutated = null
  for (let k = from; k < to; k += 1) {
    const tk = tokens[k]
    if (!(tk.type === 'ident' && tk.value === 'mutated')) continue
    if (!(tokens[k + 1] && tokens[k + 1].value === ':')) continue
    const value = tokens[k + 2]
    const found =
      value && value.type === 'ident' && MUTATED_LITERAL.has(value.value)
        ? value.value === 'true'
          ? 'yes'
          : 'no'
        : 'computed'
    // a later declaration may be the one that fires (an early `mutated: false`
    // return must not mask the `mutated: changed > 0` below it)
    if (mutated === null || MUTATED_RANK[found] > MUTATED_RANK[mutated]) mutated = found
  }
  return mutated
}

/**
 * A helper that really branches on `call.name` itself — the shared
 * `executeTool` / `executeSyncTool` executors. Following such a call would
 * credit the caller with every tool's flag, so the walk stops there. A helper
 * counts only when the branch is real: a `switch (call.name)`, or a
 * `call.name ===/!==/==/!= '...'` comparison that is an `if` condition. A
 * comparison that merely picks a value (a ternary, a `const`, an argument)
 * controls no path, so a mutating helper that mentions `call.name` that way is
 * still followed and its `mutated: true` still reaches the calling tool.
 */
function isDispatcher(fn) {
  const tokens = fn.tokens
  for (let k = fn.start; k < fn.end; k += 1) {
    if (atCallName(tokens, k)) {
      const op = tokens[k + 3]
      const cond = enclosingIfCondition(tokens, k)
      if (
        op &&
        (op.value === '===' || op.value === '!==' || op.value === '==' || op.value === '!=') &&
        cond >= fn.start
      )
        return true
      continue
    }
    // `switch (call.name)` — the statement form of the same dispatch
    if (
      tokens[k].value === 'switch' &&
      tokens[k + 1] &&
      tokens[k + 1].value === '(' &&
      atCallName(tokens, k + 2)
    )
      return true
  }
  return false
}

/** innermost enclosing function body of a token index, or null at file scope */
function enclosingFunction(functions, at) {
  let best = null
  for (const fn of functions) {
    if (fn.start <= at && at < fn.end && (!best || fn.start >= best.start)) best = fn
  }
  return best
}

/** for each function, the innermost function it is declared inside (null = file scope) */
function computeOwners(functions) {
  return functions.map((fn) => {
    let best = null
    for (const other of functions) {
      if (other === fn) continue
      if (other.start < fn.declStart && fn.declStart < other.end) {
        if (!best || other.start > best.start) best = other
      }
    }
    return best
  })
}

/**
 * The functions visible at a token index: file-level declarations, plus locals of
 * a function that encloses the index. Keyed by declaration, so two same-named
 * closures in different case bodies never shadow one another.
 */
function scopeAt(functions, owners, at) {
  const out = []
  for (let i = 0; i < functions.length; i += 1) {
    const owner = owners[i]
    if (!owner || (owner.start <= at && at < owner.end)) out.push(functions[i])
  }
  return out
}

/**
 * Non-dispatching helper named `name` visible at the call token `at`: the
 * innermost block-scoped declaration that precedes the call (a `const` arrow in
 * a case body), else a hoisted `function` declaration (which may sit below the
 * call), else the innermost enclosing one.
 */
function findHelper(scope, at, name) {
  let scoped = null
  let hoisted = null
  for (const fn of scope) {
    if (fn.name !== name || isDispatcher(fn)) continue
    if (fn.hoisted) {
      if (!hoisted || fn.start > hoisted.start) hoisted = fn
    } else if (fn.declStart < at && (!scoped || fn.declStart > scoped.declStart)) {
      scoped = fn
    }
  }
  return scoped || hoisted
}

/** `mutated:` flags reachable from a token range: its own, plus local helpers it calls */
function mutatedInRange(analysis, from, to, scope, depth = 0) {
  const tokens = analysis.tokens
  let mutated = declaredMutated(tokens, from, to)
  if (mutated === 'yes' || depth > 6) return mutated
  // the range may delegate to a local helper that declares the flag itself
  for (let k = from; k < to; k += 1) {
    if (tokens[k].type !== 'ident' || k + 1 >= to || tokens[k + 1].value !== '(') continue
    const fn = findHelper(scope, k, tokens[k].value)
    if (!fn) continue
    const inner = mutatedInRange(analysis, fn.start + 1, fn.end - 1, scope, depth + 1)
    if (inner === 'yes') return 'yes'
    if (inner && (mutated === null || MUTATED_RANK[inner] > MUTATED_RANK[mutated])) mutated = inner
  }
  return mutated
}

/** the `(` of the `if ( ... )` whose condition contains this index, or -1 */
function enclosingIfCondition(tokens, at) {
  let depth = 0
  for (let k = at - 1; k >= 0; k -= 1) {
    const v = tokens[k].value
    if (v === ')') depth += 1
    else if (v === '(') {
      if (depth === 0) {
        const prev = tokens[k - 1]
        return prev && prev.type === 'ident' && prev.value === 'if' ? k : -1
      }
      depth -= 1
    }
  }
  return -1
}

/**
 * Tokens that can continue an expression across a line break. A line break in
 * front of anything else ends the statement (ASI), which is how the fork's
 * semicolon-free braceless consequents end.
 */
const CONTINUES_EXPRESSION = new Set([
  '.',
  '?.',
  '(',
  '[',
  ',',
  '?',
  ':',
  '=',
  '=>',
  '==',
  '===',
  '!=',
  '!==',
  '<',
  '>',
  '<=',
  '>=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '&&',
  '||',
  '??',
  '|',
  '&',
  '^',
  '<<',
  '>>',
  '>>>',
  'instanceof',
  'in',
  'as',
  'satisfies',
])

const LINE_BREAK_RE = /[\n\r\u2028\u2029]/

/** is there a line terminator between two tokens in the source? */
function lineBreakBetween(src, before, after) {
  return LINE_BREAK_RE.test(src.slice(before.end, after.start))
}

/**
 * Does the statement that reached token `k` continue at `k`? Without a line
 * break it does. After one it does when the token after the break can continue
 * the expression — an operator, `.`, `(`, `[`, a tagged template,
 * `instanceof`/`in`/`as` — or when the token before the break still needs its
 * operand, as a trailing `&&` does. `return` is a restricted production: a line
 * break after it ends the statement whatever follows, so a `(`/`[` below it
 * starts a new statement and is not a continuation. Anything else starts a new
 * statement (ASI).
 */
function statementContinues(tokens, src, k) {
  const tk = tokens[k]
  const prev = tokens[k - 1]
  if (!lineBreakBetween(src, prev, tk)) return true
  if (prev.type === 'ident' && prev.value === 'return') {
    const before = tokens[k - 2]
    if (!(before && (before.value === '.' || before.value === '?.'))) return false
  }
  return continuesExpression(tk) || continuesExpression(prev)
}

/** can this token continue the expression the statement has built so far? */
function continuesExpression(tk) {
  if (tk.type === 'template') return true
  if (tk.type !== 'punct' && tk.type !== 'ident') return false
  return CONTINUES_EXPRESSION.has(tk.value)
}

/** index just past the `( ... )` header at `at`, when `at` is its `(` */
function headerEnd(tokens, at) {
  return tokens[at] && tokens[at].value === '(' ? skipBalanced(tokens, at) : at
}

/**
 * Index just past the statement that starts at `at`. A statement that is itself
 * a control statement consumes its own consequent — and, for `if`, the `else`
 * that binds to it — so a nested braceless consequent belongs to the outer
 * branch and a line break inside it never ends the outer statement. Anything
 * else is an expression statement.
 */
function statementEnd(tokens, src, at) {
  const tk = tokens[at]
  if (!tk || (tk.type !== 'punct' && tk.type !== 'ident')) {
    return expressionStatementEnd(tokens, src, at)
  }
  switch (tk.value) {
    case ';':
      return at
    case '{':
      return skipBraces(tokens, at)
    case 'if':
      return ifStatementEnd(tokens, src, at)
    case 'for': {
      // `for await (...)` is a `for` statement too
      const open = tokens[at + 1] && tokens[at + 1].value === 'await' ? at + 2 : at + 1
      return statementEnd(tokens, src, headerEnd(tokens, open))
    }
    case 'while':
      return statementEnd(tokens, src, headerEnd(tokens, at + 1))
    case 'do':
      return doStatementEnd(tokens, src, at)
    case 'switch':
      return switchStatementEnd(tokens, at)
    case 'try':
      return tryStatementEnd(tokens, src, at)
    default:
      return expressionStatementEnd(tokens, src, at)
  }
}

/**
 * `if (cond) stmt [else stmt]`. The `else` binds to the nearest `if` that is
 * still looking for one, so it belongs to this branch even when the consequent
 * is a nested `if` or the `else` sits on the line below.
 */
function ifStatementEnd(tokens, src, at) {
  let end = statementEnd(tokens, src, headerEnd(tokens, at + 1))
  if (tokens[end] && tokens[end].value === ';') end += 1
  if (tokens[end] && tokens[end].value === 'else') end = statementEnd(tokens, src, end + 1)
  return end
}

/** `do stmt while (cond)` — the `while` closes the `do` it belongs to */
function doStatementEnd(tokens, src, at) {
  const end = statementEnd(tokens, src, at + 1)
  return tokens[end] && tokens[end].value === 'while' ? headerEnd(tokens, end + 1) : end
}

/** `switch (cond) { ... }` */
function switchStatementEnd(tokens, at) {
  const header = headerEnd(tokens, at + 1)
  return tokens[header] && tokens[header].value === '{' ? skipBraces(tokens, header) : header
}

/** `try Block [catch [(param)] Block] [finally Block]` */
function tryStatementEnd(tokens, src, at) {
  let end = statementEnd(tokens, src, at + 1)
  while (tokens[end] && (tokens[end].value === 'catch' || tokens[end].value === 'finally')) {
    const header = tokens[end].value === 'catch' ? headerEnd(tokens, end + 1) : end + 1
    end = tokens[header] && tokens[header].value === '{' ? skipBraces(tokens, header) : header
  }
  return end
}

/**
 * Index just past an expression statement: through the `;` or `}` that closes
 * it at the outer level, else up to the line break where ASI ends it. A line
 * break inside an open delimiter never ends it, so a multiline call, object or
 * array stays one statement.
 */
function expressionStatementEnd(tokens, src, at) {
  let end = at
  let depth = 0
  while (end < tokens.length) {
    const tk = tokens[end]
    const punct = tk.type === 'punct'
    if (depth === 0 && end > at) {
      if (punct && (tk.value === ';' || tk.value === '}')) break
      if (!statementContinues(tokens, src, end)) break
    }
    if (punct && (tk.value === '(' || tk.value === '[' || tk.value === '{')) depth += 1
    else if (punct && (tk.value === ')' || tk.value === ']' || tk.value === '}')) {
      if (depth === 0) break
      depth -= 1
    }
    end += 1
  }
  return end
}

/**
 * [start, end) of the branch the `if (...)` at `openIdx` controls. A block
 * branch ends at its matching `}`; a braceless branch is one statement, and the
 * walk above finds that statement's real end — so a semicolon-free consequent
 * stops where ASI ends it and never runs on into the code beneath it. Reading to
 * the next `;`/`}` alone ran the markdown guard `=== 'ask_clarification'`
 * through the whole `switch` below and over-reported `editor_write`.
 */
function branchRange(analysis, openIdx) {
  const tokens = analysis.tokens
  const start = skipBalanced(tokens, openIdx)
  if (tokens[start] && tokens[start].type === 'punct' && tokens[start].value === '{') {
    const end = skipBraces(tokens, start)
    return { start: start + 1, end: end - 1, branchStart: start, branchEnd: end }
  }
  const end = statementEnd(tokens, analysis.src, start)
  return { start, end, branchStart: start, branchEnd: end }
}

/**
 * The region(s) a `call.name` equality guard controls: the branch the named tool
 * takes for `===`; for `!==` the rest of the enclosing body (the tool's own
 * fall-through path, with the early-return branch excluded). Null when the guard
 * is not an `if` condition — a ternary, a `const` or an argument controls no
 * path, so it must not name a tool.
 */
function guardRegions(analysis, at, op, functions, _owners) {
  const tokens = analysis.tokens
  const open = enclosingIfCondition(tokens, at)
  if (open < 0) return null
  const branch = branchRange(analysis, open)
  if (op === '===' || op === '==') return [{ from: branch.start, to: branch.end }]
  const fn = enclosingFunction(functions, at)
  if (!fn) return null
  return [{ from: branch.branchEnd, to: fn.end - 1 }]
}

/**
 * `call.name === 'x'` / `call.name !== 'x'` guards (the skill files route with an
 * equality test instead of a switch); each guard names its tool, and only the
 * flags on that tool's own path are credited.
 */
function collectGuardDeclarations(analysis, found, owners) {
  const tokens = analysis.tokens
  for (let i = 0; i < tokens.length - 4; i += 1) {
    if (!atCallName(tokens, i)) continue
    const op = tokens[i + 3]
    if (!(
      op &&
      (op.value === '===' || op.value === '!==' || op.value === '==' || op.value === '!=')
    ))
      continue
    const lit = tokens[i + 4]
    if (!(lit && lit.type === 'string')) continue
    const regions = guardRegions(analysis, i, op.value, analysis.functions, owners)
    if (!regions) continue
    const scope = scopeAt(analysis.functions, owners, i)
    let value = null
    for (const region of regions) {
      const m = mutatedInRange(analysis, region.from, region.to, scope)
      const v = m === 'computed' ? 'yes' : m
      if (v === 'yes') {
        value = 'yes'
        break
      }
      if (v && value === null) value = v
    }
    if (value === null) continue
    const prev = found.get(lit.value)
    if (!prev || (prev === 'no' && value === 'yes')) found.set(lit.value, value)
  }
}

/** name → 'yes' | 'no' | 'undeclared', from the routing this module's code uses */
function collectMutatedDeclarations(files) {
  const found = new Map()
  for (const analysis of files) {
    const owners = computeOwners(analysis.functions)
    collectGuardDeclarations(analysis, found, owners)
    const tokens = analysis.tokens
    for (let i = 0; i < tokens.length; i += 1) {
      if (!(tokens[i].type === 'ident' && tokens[i].value === 'switch')) continue
      if (!(tokens[i + 1] && tokens[i + 1].value === '(')) continue
      if (!atCallName(tokens, i + 2)) continue
      let open = i + 5
      while (open < tokens.length && tokens[open].value !== '{') open += 1
      if (open >= tokens.length) continue
      const cases = collectCases(analysis, open, owners)
      for (const entry of cases) {
        for (const name of entry.names) {
          const prev = found.get(name)
          const value = entry.mutated === 'computed' ? 'yes' : entry.mutated
          if (value === null) continue
          if (!prev || (prev === 'no' && value === 'yes')) found.set(name, value)
          else if (!found.has(name)) found.set(name, value)
        }
      }
    }
  }
  return found
}

function collectCases(analysis, openIdx, owners) {
  const tokens = analysis.tokens
  const out = []
  let depth = 0
  let names = []
  let carry = []
  let bodyStart = -1
  const finish = (end) => {
    if (bodyStart < 0) return
    const body = tokens.slice(bodyStart, end)
    const empty = !body.some(
      (t) =>
        t.type === 'ident' || t.type === 'string' || t.type === 'number' || t.type === 'template',
    )
    const scope = scopeAt(analysis.functions, owners, bodyStart)
    const mutated = mutatedInRange(analysis, bodyStart, end, scope)
    if (empty) {
      carry = carry.concat(names)
    } else {
      out.push({ names: carry.concat(names), mutated })
      carry = []
    }
    names = []
  }
  for (let idx = openIdx; idx < tokens.length; idx += 1) {
    const tk = tokens[idx]
    if (tk.value === '{') depth += 1
    else if (tk.value === '}') {
      depth -= 1
      if (depth === 0) {
        finish(idx)
        break
      }
      continue
    }
    if (depth !== 1) continue
    if (tk.type === 'ident' && tk.value === 'case') {
      finish(idx)
      const label = tokens[idx + 1]
      names =
        label && (label.type === 'string' || label.type === 'number') ? [String(label.value)] : []
      bodyStart = -1
      continue
    }
    if (tk.type === 'ident' && tk.value === 'default') {
      finish(idx)
      names = []
      bodyStart = -1
      continue
    }
    if (tk.value === ':' && bodyStart < 0) bodyStart = idx + 1
  }
  return out
}

/** names declared in a `READ_ONLY_TOOLS` / `VIEW_ONLY_TOOLS` set inside the module */
function collectReadOnlyNames(files) {
  const names = new Set()
  for (const analysis of files) {
    for (const setName of ['READ_ONLY_TOOLS', 'VIEW_ONLY_TOOLS']) {
      const decl = analysis.locals.get(setName)
      if (!decl) continue
      const r = parseExpression(
        decl.tokens,
        decl.index,
        {
          file: analysis.path,
          locals: analysis.locals,
          imports: analysis.imports,
          bindings: new Map(),
          ctx: null,
        },
        0,
      )
      if (Array.isArray(r.value)) {
        for (const v of r.value) if (typeof v === 'string') names.add(v)
      }
    }
  }
  return names
}

// ──────────────────────────── extraction ────────────────────────────

/**
 * An identifier naming a tool-*definition* type: `AgentToolDef`, or the bare
 * `AgentTool` some code bases use for the same thing. The match is exact, not a
 * prefix: `AgentToolCall` / `AgentToolResult` / `AgentToolbar` are call, result
 * and UI types whose arrays hold records, not tool definitions, so a
 * `{ name, description }` element of such an array must not become a row.
 */
const TOOL_DEF_TYPE_RE = /^(?:AgentToolDef|AgentTool)$/

/**
 * Index of the `)` that closes the parameter list of the accessor whose body
 * brace is at `bodyOpen`, or -1. In `get tools() {` the `)` sits right before
 * the body; the annotated spelling `get tools(): AgentToolDef[] {` puts a
 * return-type annotation between them, so the walk back skips that annotation
 * (balanced `()` / `[]` / `<>` groups) and stops at the `:` that separates it
 * from the parameter list (R1-2). Any other brace head returns -1.
 */
function accessorParamClose(tokens, bodyOpen) {
  const prev = tokens[bodyOpen - 1]
  if (prev && prev.value === ')') return bodyOpen - 1
  let depth = 0
  for (let k = bodyOpen - 1; k >= 0; k -= 1) {
    const tk = tokens[k]
    if (tk.type !== 'punct') continue
    const v = tk.value
    if (v === ')' || v === ']' || v === '>') depth += 1
    else if (v === '(' || v === '[' || v === '<') {
      if (depth === 0) return -1
      depth -= 1
    } else if (depth === 0) {
      if (v === ':') return tokens[k - 1] && tokens[k - 1].value === ')' ? k - 1 : -1
      if (v === '{' || v === '}' || v === ';' || v === '=' || v === ',') return -1
    }
  }
  return -1
}

/**
 * Is token index `at` the operand of a `return` at a `get tools()` accessor
 * body's own brace level? Only the innermost enclosing brace is consulted: the
 * body brace of `get tools() { ... }` — whose head may carry a return-type
 * annotation — opens a tools list, while a `return [ ... ]` nested deeper
 * inside the accessor (a local helper, a control block) is that statement's own
 * value and must not manufacture a phantom row (R1-3). Any other accessor
 * (`get options()`) returns false.
 */
function insideToolsAccessor(tokens, at) {
  const stack = []
  for (let k = 0; k < at; k += 1) {
    const tk = tokens[k]
    if (tk.type !== 'punct') continue // a string/template `{` is not a brace
    if (tk.value === '{') stack.push(k)
    else if (tk.value === '}') stack.pop()
  }
  const bodyOpen = stack[stack.length - 1]
  if (bodyOpen === undefined) return false
  const close = accessorParamClose(tokens, bodyOpen)
  if (close < 0) return false
  const open = tokens[close - 1]
  const name = tokens[close - 2]
  const get = tokens[close - 3]
  return (
    !!open &&
    open.value === '(' &&
    !!name &&
    name.type === 'ident' &&
    name.value === 'tools' &&
    !!get &&
    get.type === 'ident' &&
    get.value === 'get'
  )
}

/** the `{` of the object literal that encloses token index `at`, or -1 */
function enclosingBrace(tokens, at) {
  let depth = 0
  for (let k = at - 1; k >= 0; k -= 1) {
    const tk = tokens[k]
    if (tk.type !== 'punct') continue
    if (tk.value === '}') depth += 1
    else if (tk.value === '{') {
      if (depth === 0) return k
      depth -= 1
    }
  }
  return -1
}

/**
 * Is the array literal at `at` — the value of a `tools:` field — inside a
 * schema bag, i.e. inside an object that is the value of a `properties` /
 * `inputSchema` key at any nesting level? A `tools` property of a schema
 * describes a schema property; its items are not tools, however tool-shaped
 * they look (R1-1).
 */
function insideSchemaBag(tokens, at) {
  for (let open = enclosingBrace(tokens, at); open >= 0; open = enclosingBrace(tokens, open)) {
    const colon = tokens[open - 1]
    const key = tokens[open - 2]
    if (!(colon && colon.type === 'punct' && colon.value === ':')) continue
    if (!(key && (key.type === 'ident' || key.type === 'string'))) continue
    if (key.value === 'properties' || key.value === 'inputSchema') return true
  }
  return false
}

/**
 * Token indices of the `[` that open a tools-list array literal. Three written
 * forms are a tools list:
 *   1. an annotated binding — `AgentToolDef[] = [`, `readonly AgentToolDef[] = [`,
 *      `Array<AgentToolDef> = [`;
 *   2. the value of a `tools:` field outside a schema bag — `tools: [ ... ]`;
 *   3. the operand of `return` inside a `get tools()` accessor —
 *      `get tools() { return [ ... ] }`.
 * Any other array — an unannotated array, one typed as something else (an
 * option list, a typed command list), a nested `options:` bag, a `tools` bag
 * inside a schema, a `get options()` returned literal, a plain helper's
 * `return [ ... ]` — is not a tools list for the `name` anchor below, so a
 * non-tool `{ name, description }` element cannot manufacture a phantom row.
 */
function toolListArrayIndices(tokens) {
  const out = new Set()
  for (let b = 1; b < tokens.length; b += 1) {
    const tk = tokens[b]
    if (!(tk.type === 'punct' && tk.value === '[')) continue

    // `tools: [ ... ]` — the value of a `tools` field is a tools list, unless
    // the field sits inside a schema: `properties: { tools: [ … ] }` describes
    // a schema property, so its items are not tools however tool-shaped they
    // look
    const colon = tokens[b - 1]
    const fieldName = tokens[b - 2]
    if (
      colon &&
      colon.type === 'punct' &&
      colon.value === ':' &&
      fieldName &&
      fieldName.type === 'ident' &&
      fieldName.value === 'tools' &&
      !insideSchemaBag(tokens, b)
    ) {
      out.add(b)
      continue
    }

    // `return [ ... ]` inside a `get tools()` accessor — a tools list written as
    // a returned array literal rather than an annotated binding
    const ret = tokens[b - 1]
    if (ret && ret.type === 'ident' && ret.value === 'return' && insideToolsAccessor(tokens, b)) {
      out.add(b)
      continue
    }

    const eq = tokens[b - 1]
    if (!(eq && eq.type === 'punct' && eq.value === '=')) continue
    const close = tokens[b - 2]
    // `X[] = [` — the annotation is a bare tool-def ident followed by `[]`
    const open = tokens[b - 3]
    const name = tokens[b - 4]
    if (
      close &&
      close.value === ']' &&
      open &&
      open.value === '[' &&
      name &&
      name.type === 'ident' &&
      TOOL_DEF_TYPE_RE.test(name.value)
    ) {
      out.add(b)
      continue
    }
    // `Array<X> = [` / `ReadonlyArray<X> = [` — walk back over the generic args
    if (close && close.value === '>') {
      let k = b - 2
      let depth = 0
      while (k >= 0) {
        const v = tokens[k].value
        if (v === '>') depth += 1
        else if (v === '<') {
          depth -= 1
          if (depth === 0) break
        }
        k -= 1
      }
      const head = tokens[k - 1]
      const arg = tokens[k + 1]
      if (
        head &&
        head.type === 'ident' &&
        /^(?:Readonly)?Array$/.test(head.value) &&
        arg &&
        arg.type === 'ident' &&
        TOOL_DEF_TYPE_RE.test(arg.value)
      ) {
        out.add(b)
      }
    }
  }
  return out
}

/**
 * Candidate tool object literals. `inputSchema` is the primary anchor: any
 * object carrying that key at a value position is a tool definition. `name` is
 * a second anchor, limited to an element of a tools-list array literal (see
 * `toolListArrayIndices`), so a tool-shaped object without `inputSchema` is
 * still found and reported as `unresolved:missing` instead of vanishing, while
 * a `{ name, description }` object in any other array — an option list, a
 * command palette, a nested options bag — is left alone; the array-element
 * restriction also keeps interface / type-literal braces (which parse as junk)
 * out of the set.
 */
function findToolObjectTokens(tokens) {
  const toolLists = toolListArrayIndices(tokens)
  const stack = []
  const brackets = []
  const out = []
  const seen = new Set()
  for (let i = 0; i < tokens.length; i += 1) {
    const tk = tokens[i]
    if (tk.type === 'punct') {
      if (tk.value === '{') stack.push(i)
      else if (tk.value === '}') stack.pop()
      else if (tk.value === '[') brackets.push(i)
      else if (tk.value === ']') brackets.pop()
      continue
    }
    if (tk.type !== 'ident' && tk.type !== 'string') continue
    if (tk.value !== 'name' && tk.value !== 'inputSchema') continue
    const next = tokens[i + 1]
    if (!(next && next.type === 'punct' && next.value === ':')) continue
    const objIdx = stack[stack.length - 1]
    if (objIdx === undefined || seen.has(objIdx)) continue
    const before = tokens[objIdx - 1]
    if (tk.value === 'name') {
      // only an element of a tools-list array: preceded by `[`, `,` or `...`,
      // and the innermost enclosing array annotated as a tool-def list
      const arr = brackets[brackets.length - 1]
      if (arr === undefined || !toolLists.has(arr)) continue
      if (!(before && before.type === 'punct' && ['[', ',', '...'].includes(before.value))) continue
    } else if (before && before.type === 'punct' && before.value === ':') {
      // a nested property bag such as `properties: { inputSchema: ... }`
      continue
    }
    seen.add(objIdx)
    out.push(objIdx)
  }
  return out
}

export function extract({ repo, rev }) {
  const sha = git(repo, ['rev-parse', '--verify', `${rev}^{commit}`]).trim()
  const listing = git(repo, ['ls-tree', '-r', '--name-only', sha]).split('\n').filter(Boolean)
  const fileSet = new Set(listing)
  const ctx = {
    repo,
    rev: sha,
    fileSet,
    fileCache: new Map(),
    pkgDirs: null,
    resolveModule(fromFile, spec) {
      const candidates = []
      if (spec.startsWith('.')) {
        const base = posix.normalize(posix.join(posix.dirname(fromFile), spec))
        candidates.push(base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`)
      } else {
        const dir = this.packageDirOf(spec)
        if (dir) {
          const parts = spec.split('/')
          const pkgName = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
          const sub = spec.slice(pkgName.length + 1)
          if (sub) {
            candidates.push(
              `${dir}/src/${sub}.ts`,
              `${dir}/src/${sub}.tsx`,
              `${dir}/src/${sub}/index.ts`,
              `${dir}/${sub}.ts`,
              `${dir}/${sub}.tsx`,
            )
          } else {
            candidates.push(`${dir}/src/index.ts`, `${dir}/src/index.tsx`, `${dir}/index.ts`)
          }
        }
      }
      for (const c of candidates) if (fileSet.has(c)) return c
      return null
    },
    packageDirOf(spec) {
      if (!this.pkgDirs) {
        this.pkgDirs = new Map()
        for (const p of listing) {
          if (!/^(?:packages|apps)\/[^/]+\/package\.json$/.test(p)) continue
          const text = readAt(repo, sha, p, this.fileCache)
          if (!text) continue
          try {
            const name = JSON.parse(text).name
            if (typeof name === 'string') this.pkgDirs.set(name, posix.dirname(p))
          } catch {
            // an unparsable manifest simply does not resolve
          }
        }
      }
      return this.pkgDirs.get(
        spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0],
      )
    },
  }

  const groups = new Map()
  for (const path of listing) {
    let module = null
    for (const root of SCAN_ROOTS) {
      const m = root.re.exec(path)
      if (!m) continue
      module = root.module || m[1]
      break
    }
    if (!module) continue
    if (!groups.has(module)) groups.set(module, [])
    groups.get(module).push(path)
  }

  const rows = []
  for (const [module, paths] of groups) {
    const analyses = paths.map((p) => analyzeFile(repo, sha, p, ctx))
    const mutated = collectMutatedDeclarations(analyses)
    const readOnly = collectReadOnlyNames(analyses)
    for (const analysis of analyses) {
      const scope = {
        file: analysis.path,
        locals: analysis.locals,
        imports: analysis.imports,
        bindings: new Map(),
        ctx,
      }
      for (const objIdx of findToolObjectTokens(analysis.tokens)) {
        const parsed = parseExpression(analysis.tokens, objIdx, scope, 0)
        const value = parsed.value
        if (!isPlainObject(value)) continue
        if (typeof value.name !== 'string') continue
        if (!Object.prototype.hasOwnProperty.call(value, 'description')) continue
        let hash
        if (!Object.prototype.hasOwnProperty.call(value, 'inputSchema')) {
          // a tool-shaped object with no schema is still a tool: report it, never drop it
          hash = 'unresolved:missing'
        } else {
          const schema = value.inputSchema
          const reason = isU(schema) ? schema.__unresolved : findUnresolved(schema)
          hash = reason
            ? `unresolved:${reason}`
            : createHash('sha256').update(canonicalJson(schema), 'utf8').digest('hex')
        }
        let write = 'undeclared'
        const declared = mutated.get(value.name)
        if (declared) write = declared
        else if (readOnly.has(value.name)) write = 'no'
        rows.push({
          module,
          tool: value.name,
          hash,
          write,
          source: analysis.path,
        })
      }
    }
  }

  rows.sort((a, b) => cmp(a.module, b.module) || cmp(a.tool, b.tool) || cmp(a.source, b.source))

  const lines = [
    `<!-- genoffice-tools-extract v1 rev=${sha} -->`,
    '| module | tool | input_schema_sha256 | editor_write | source |',
    '| --- | --- | --- | --- | --- |',
  ]
  for (const row of rows) {
    lines.push(`| ${row.module} | ${row.tool} | ${row.hash} | ${row.write} | ${row.source} |`)
  }
  return { sha, rows, text: `${lines.join('\n')}\n` }
}

// ──────────────────────────────── CLI ────────────────────────────────

function parseArgs(argv) {
  const args = { rev: 'HEAD', repo: null }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--rev') args.rev = argv[++i]
    else if (a === '--repo') args.repo = argv[++i]
    else if (a === '--help' || a === '-h') args.help = true
    else {
      process.stderr.write(`genoffice-tools-extract: unknown argument: ${a}\n${USAGE}\n`)
      process.exit(2)
    }
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  let repo = args.repo
  if (!repo) {
    const top = gitTry(process.cwd(), ['rev-parse', '--show-toplevel'])
    if (top === null) {
      process.stderr.write(
        'genoffice-tools-extract: not inside a git work tree; pass --repo <dir>\n',
      )
      process.exit(1)
    }
    repo = top.trim()
  }
  let result
  try {
    result = extract({ repo, rev: args.rev })
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
    process.stderr.write(
      `genoffice-tools-extract: cannot read rev "${args.rev}" in ${repo}: ${message}\n`,
    )
    process.exit(1)
  }
  process.stdout.write(result.text)
}

// Only run as a CLI; importing the module (tests) must not print or exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
