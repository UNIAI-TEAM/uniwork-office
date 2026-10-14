#!/usr/bin/env node
// Repository-wide English-only guard: no Chinese may appear in tracked code
// comments or documentation prose. Catch violations in the change that
// introduces them.
//
// Functional CJK string literals are fine (i18n resources, test fixture
// text, zh-UI matchers), as are the AI prompt guides (runtime resources that
// legitimately show CJK examples), translated READMEs under an i18n directory,
// and the language-switcher line that names those translations. Fenced code
// blocks in Markdown are code, not prose, and are exempt.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HAN = /[\u3400-\u9fff]/

/** Returns the violation lines (`  file:line: text`) for one tracked file. */
export function findViolations(file, content) {
  const isCode = /\.(ts|tsx|mjs|cjs|js|rs)$/.test(file)
  const isHashCode = /\.(py|sh)$/.test(file)
  const isDoc =
    /\.(md|html?)$/.test(file) && !file.includes('/ai/prompts/') && !file.includes('/i18n/')
  if (!isCode && !isHashCode && !isDoc) return []
  const isMd = file.endsWith('.md')
  const violations = []
  let inFence = false
  content.split('\n').forEach((line, index) => {
    if (isMd && /^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      return
    }
    if (inFence) return
    const text = isDoc
      ? line
      : isHashCode
        ? line.match(/(?:^|[^'"])#(.*)$/)?.[1]
        : (line.match(/(?:^|[^:'"])\/\/(.*)$/) ??
            line.match(/^\s*\*(.*)$/) ??
            line.match(/\/\*(.*)$/))?.[1]
    if (text !== undefined && HAN.test(text) && !line.includes('lang-switcher')) {
      violations.push(`  ${file}:${index + 1}: ${line.trim()}`)
    }
  })
  return violations
}

function main() {
  const git = spawnSync('git', ['ls-files'], { encoding: 'utf8' })
  if (git.status !== 0) {
    console.error(git.stderr)
    process.exit(git.status ?? 1)
  }
  const root = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).stdout.trim()
  const violations = git.stdout
    .trim()
    .split('\n')
    .flatMap((file) => findViolations(file, readFileSync(join(root, file), 'utf8')))
  if (violations.length > 0) {
    console.error(
      `Chinese text found in code comments or docs:\n${violations.join('\n')}\n` +
        'Comments and documentation must be English-only. Move CJK text into ' +
        'string literals or rewrite the comment in English.',
    )
    process.exit(1)
  }
  console.log('check-english-comments: OK')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
