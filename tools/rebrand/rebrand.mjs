#!/usr/bin/env node
// Idempotent UniWork rebrand of a genoffice tree.
//
//   node tools/rebrand/rebrand.mjs            apply the table + asset overlay
//   node tools/rebrand/rebrand.mjs --check    change nothing, exit 1 if a run would
//   node tools/rebrand/rebrand.mjs --root <dir>   operate on another checkout
//
// The replacement table lives in table.mjs, the artwork overlay in assets/
// (same relative paths as the repo). See README.md for the upstream sync flow.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GLOBAL_EXCLUDE, rules } from './table.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, 'assets')
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|pdf|zip|gz|wasm|node|docx|pptx|xlsx|mp4|mov)$/i
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|\{\/\*|<!--)/

export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      const end = glob.indexOf('}', i)
      re += `(?:${glob
        .slice(i + 1, end)
        .split(',')
        .map((p) => globToRegExp(p).source.slice(1, -1))
        .join('|')})`
      i = end
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

const globCache = new Map()
export function matchesAny(path, globs) {
  return globs.some((g) => {
    let re = globCache.get(g)
    if (!re) globCache.set(g, (re = globToRegExp(g)))
    return re.test(path)
  })
}

/** Applies one text rule to file content, line-wise when comments are skipped. */
export function applyRule(rule, text) {
  if (rule.transform) return rule.transform(text)
  const pairs = rule.replace ?? []
  if (!rule.skipComments && !rule.skipLines) {
    return pairs.reduce((t, [re, to]) => t.replace(re, to), text)
  }
  const skip = (line) =>
    (rule.skipComments && COMMENT_LINE.test(line)) ||
    (rule.skipLines ?? []).some((re) => re.test(line))
  return text
    .split(/(?<=\n)/)
    .map((line) => (skip(line) ? line : pairs.reduce((t, [re, to]) => t.replace(re, to), line)))
    .join('')
}

function listTrackedFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.toString('utf8').split('\0').filter(Boolean)
  } catch {
    return walk(root, root)
  }
}

function walk(root, dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(root, p, acc)
    else acc.push(relative(root, p).split(sep).join('/'))
  }
  return acc
}

function listAssets(dir = ASSETS, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) listAssets(p, acc)
    else acc.push(relative(ASSETS, p).split(sep).join('/'))
  }
  return acc
}

/**
 * Computes (and with write=true applies) every rebrand change under `root`.
 * Returns { changed: [{file, rules}], overlays: [file] }.
 */
export function rebrand(root, { write = false } = {}) {
  const changed = []
  for (const file of listTrackedFiles(root)) {
    if (BINARY_EXT.test(file)) continue
    const applicable = rules.filter(
      (r) =>
        matchesAny(file, r.files) &&
        !matchesAny(file, [...(r.ignoreGlobalExclude ? [] : GLOBAL_EXCLUDE), ...(r.exclude ?? [])]),
    )
    if (applicable.length === 0) continue
    const abs = join(root, file)
    if (!existsSync(abs)) continue
    const original = readFileSync(abs)
    if (original.includes(0)) continue
    const before = original.toString('utf8')
    let text = before
    const hit = []
    for (const rule of applicable) {
      const next = applyRule(rule, text)
      if (next !== text) hit.push(rule.id)
      text = next
    }
    if (text !== before) {
      changed.push({ file, rules: hit })
      if (write) writeFileSync(abs, text)
    }
  }

  const overlays = []
  for (const rel of listAssets()) {
    const target = join(root, rel)
    const src = readFileSync(join(ASSETS, rel))
    if (existsSync(target) && readFileSync(target).equals(src)) continue
    overlays.push(rel)
    if (write) {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, src)
    }
  }
  return { changed, overlays }
}

function main(argv) {
  const check = argv.includes('--check')
  const rootArg = argv.indexOf('--root')
  const root = resolve(
    rootArg >= 0
      ? argv[rootArg + 1]
      : execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim(),
  )
  const { changed, overlays } = rebrand(root, { write: !check })
  const total = changed.length + overlays.length
  const verb = check ? 'would change' : 'changed'
  for (const c of changed) console.log(`${verb}  ${c.file}  [${c.rules.join(', ')}]`)
  for (const o of overlays) console.log(`${verb}  ${o}  [asset overlay]`)
  console.log(
    total === 0
      ? 'rebrand: already up to date'
      : `rebrand: ${verb} ${changed.length} text file(s), ${overlays.length} asset(s)`,
  )
  if (check && total > 0) {
    console.error(
      'rebrand --check failed: run `node tools/rebrand/rebrand.mjs` and commit the result.',
    )
    process.exit(1)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
}
