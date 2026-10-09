#!/usr/bin/env node
// Keeps the legal text in step with apps/shell/src/shared/legal.json, the one
// place the product's legal identity (company, contact, homepage, year) and the
// upstream attribution live.
//
//   node tools/legal/sync-legal.mjs            # rewrite (npm run legal)
//   node tools/legal/sync-legal.mjs --check    # exit 1 if a run would change anything (npm run legal:check)
//   node tools/legal/sync-legal.mjs --root <dir>
//
// What it owns:
//   NOTICE          everything above the "Bundled third-party components" paragraph:
//                   the UniWork header, the upstream NOTICE verbatim (Apache-2.0 4(d)),
//                   the trademark sentence and the pointer to MODIFICATIONS
//   MODIFICATIONS   everything above "Summary of changes": the 4(b) statement with the
//                   company, year and the upstream commit from tools/rebrand/UPSTREAM_BASE
//   package.json    apps/shell: author { name, email } and homepage; every other apps/*
//                   package that declares an author: the same author; apps/docs (packaged
//                   on its own): build.copyright. The root package declares neither field.
// The text below those anchors is hand-written and left alone.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const LEGAL_JSON = 'apps/shell/src/shared/legal.json'
export const UPSTREAM_BASE = 'tools/rebrand/UPSTREAM_BASE'
export const UPSTREAM_REPO = 'genspark-ai/genoffice'
/** First paragraph of the hand-written NOTICE body; the generated header ends right before it. */
export const NOTICE_ANCHOR = 'Bundled third-party components'
/** Heading of the hand-written MODIFICATIONS body. */
export const MODIFICATIONS_ANCHOR = 'Summary of changes'
const WIDTH = 76

const NBSP = ' '

/**
 * Greedy word wrap of one paragraph to `width` columns. A company suffix
 * ("Example, Inc.") never starts a line.
 */
export function wrap(text, width = WIDTH) {
  const lines = []
  let line = ''
  const glued = text.replace(/, (Inc\.|Ltd\.|LLC|GmbH)/g, `,${NBSP}$1`)
  for (const word of glued.split(/[ \t\n]+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.join('\n').replaceAll(NBSP, ' ')
}

export function validateLegal(legal) {
  for (const key of ['product', 'company', 'email', 'homepage']) {
    if (typeof legal[key] !== 'string' || !legal[key].trim()) {
      throw new Error(`${LEGAL_JSON}: "${key}" must be a non-empty string`)
    }
  }
  if (!Number.isInteger(legal.copyrightYear)) {
    throw new Error(`${LEGAL_JSON}: "copyrightYear" must be an integer`)
  }
  if (!/^https:\/\//.test(legal.homepage) || /github\.com/i.test(legal.homepage)) {
    throw new Error(
      `${LEGAL_JSON}: "homepage" must be an https URL that is not a code-hosting page`,
    )
  }
  const up = legal.upstream ?? {}
  for (const key of ['name', 'copyright', 'license', 'notice', 'trademarks']) {
    if (typeof up[key] !== 'string' || !up[key].trim()) {
      throw new Error(`${LEGAL_JSON}: "upstream.${key}" must be a non-empty string`)
    }
  }
  return legal
}

export function copyrightLine(legal) {
  return `Copyright ${legal.copyrightYear} ${legal.company}`
}

/** The generated NOTICE header, ending in one blank line before the anchor paragraph. */
export function noticeHeader(legal) {
  const up = legal.upstream
  return [
    legal.product,
    copyrightLine(legal),
    '',
    wrap(
      `${legal.product} is a modified version of ${up.name}, licensed under the ` +
        `${up.license} (see LICENSE). The original ${up.name} NOTICE follows; it is ` +
        'retained as section 4(d) of the license requires.',
    ),
    '',
    up.notice.trimEnd(),
    '',
    wrap(up.trademarks),
    '',
    wrap(`The changes ${legal.company} made to ${up.name} are described in MODIFICATIONS.`),
    '',
    '',
  ].join('\n')
}

function replaceHead(text, anchor, head, file) {
  const at = text.search(new RegExp(`^${anchor}`, 'm'))
  if (at < 0) throw new Error(`${file}: no paragraph starting with "${anchor}" to anchor on`)
  return head + text.slice(at)
}

export function syncNotice(text, legal) {
  return replaceHead(text.replace(/\r\n/g, '\n'), NOTICE_ANCHOR, noticeHeader(legal), 'NOTICE')
}

export function modificationsHeader(legal, upstreamSha) {
  const up = legal.upstream
  if (!/^[0-9a-f]{40}$/.test(upstreamSha)) {
    throw new Error(`${UPSTREAM_BASE} must hold a full 40-character commit id`)
  }
  return [
    `${legal.product} — statement of modifications`,
    `Modified by ${legal.company}, ${legal.copyrightYear}.`,
    '',
    wrap(
      `${legal.product} is a modified version of ${up.name} (${up.copyright}), ` +
        `licensed under the ${up.license}. It is derived from ${up.name} at upstream ` +
        `commit ${upstreamSha} of the source repository ${UPSTREAM_REPO}.`,
    ),
    '',
    wrap(
      `As section 4(b) of the license requires, this file states that ${legal.company} ` +
        'changed files of the original work. The statement applies collectively to every ' +
        'file that differs from that upstream commit, instead of a notice in each file; ' +
        'the authoritative list of modified files is the difference between this source ' +
        'tree and that commit.',
    ),
    '',
    '',
  ].join('\n')
}

export function syncModifications(text, legal, upstreamSha) {
  return replaceHead(
    text.replace(/\r\n/g, '\n'),
    MODIFICATIONS_ANCHOR,
    modificationsHeader(legal, upstreamSha),
    'MODIFICATIONS',
  )
}

/**
 * package.json metadata. `role` is 'shell' (author + homepage), 'docs' (author +
 * build.copyright, it is packaged standalone) or 'app' (author, only if declared).
 */
export function syncPackageJson(text, legal, role) {
  const pkg = JSON.parse(text)
  const author = { name: legal.company, email: legal.email }
  if (role === 'shell' || 'author' in pkg) pkg.author = author
  if (role === 'shell') pkg.homepage = legal.homepage
  if (role === 'docs' && pkg.build) {
    pkg.build.copyright = `Copyright © ${legal.copyrightYear} ${legal.company}`
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

function appPackages(root) {
  const apps = join(root, 'apps')
  if (!existsSync(apps)) return []
  return readdirSync(apps, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(apps, e.name, 'package.json')))
    .map((e) => ({
      file: `apps/${e.name}/package.json`,
      role: e.name === 'shell' ? 'shell' : e.name === 'docs' ? 'docs' : 'app',
    }))
}

/** Computes (and with write: true applies) every change. Returns { changed: [repo-relative paths] }. */
export function syncLegal(root, { write = false } = {}) {
  const read = (f) => readFileSync(join(root, f), 'utf8')
  const legal = validateLegal(JSON.parse(read(LEGAL_JSON)))
  const sha = read(UPSTREAM_BASE).trim()
  const jobs = [
    ['NOTICE', (t) => syncNotice(t, legal)],
    ['MODIFICATIONS', (t) => syncModifications(t, legal, sha)],
    ...appPackages(root).map(({ file, role }) => [file, (t) => syncPackageJson(t, legal, role)]),
  ]
  const changed = []
  for (const [file, fn] of jobs) {
    const before = read(file)
    const after = fn(before)
    if (after !== before) {
      changed.push(file)
      if (write) writeFileSync(join(root, file), after)
    }
  }
  return { changed }
}

function main(argv) {
  const check = argv.includes('--check')
  const at = argv.indexOf('--root')
  const root = at >= 0 ? resolve(argv[at + 1]) : resolve(HERE, '../..')
  const { changed } = syncLegal(root, { write: !check })
  if (check) {
    if (changed.length) {
      console.error(`legal:check: out of date, run npm run legal\n  ${changed.join('\n  ')}`)
      return 1
    }
    console.log('legal:check: NOTICE, MODIFICATIONS and package metadata match legal.json')
    return 0
  }
  console.log(changed.length ? `legal: updated\n  ${changed.join('\n  ')}` : 'legal: up to date')
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
