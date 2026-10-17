#!/usr/bin/env node
// Build-time-only patch helper for G7-05 T3/T4 synthetic N+1 test build (1.0.0-g705n1, APP_STORE_LEVEL = 3).
// Must NEVER be committed to product code; applied in an ephemeral git worktree during build-upgrade-matrix.sh.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, '../..')

export const N1_PATCHED_FILES = [
  'apps/shell/src/main/uniwork-sync/store-level.ts',
  'apps/shell/src/main/uniwork-docs/binding-store.ts',
  'apps/shell/src/main/uniwork-sync/store/layer.ts',
  'apps/shell/src/main/uniwork-sync/migration.ts',
  'package.json',
  'apps/shell/package.json',
]

function replaceExactOnce(filePath, target, replacement, label) {
  const before = readFileSync(filePath, 'utf8')
  if (!before.includes(target)) {
    throw new Error(`[apply-n1-patch] Expected target for ${label} not found in ${filePath}`)
  }
  const parts = before.split(target)
  if (parts.length !== 2) {
    throw new Error(
      `[apply-n1-patch] Expected target for ${label} to appear once in ${filePath}, found ${parts.length - 1}`,
    )
  }
  const after = parts.join(replacement)
  writeFileSync(filePath, after, 'utf8')
}

export function applyN1BuildTimePatch(
  repoRoot = DEFAULT_REPO_ROOT,
  { version = '1.0.0-g705n1', storeLevel = 3 } = {},
) {
  const absRoot = resolve(repoRoot)

  // 1. Bump APP_STORE_LEVEL from 2 to 3 in store-level.ts.
  const storeLevelPath = join(absRoot, 'apps/shell/src/main/uniwork-sync/store-level.ts')
  replaceExactOnce(
    storeLevelPath,
    'export const APP_STORE_LEVEL = 2',
    `export const APP_STORE_LEVEL = ${Number(storeLevel)}`,
    'APP_STORE_LEVEL',
  )

  // 2. Ensure binding-store.ts promotes schema-2 bindings to at least APP_STORE_LEVEL when read/written by N+1.
  const bindingStorePath = join(absRoot, 'apps/shell/src/main/uniwork-docs/binding-store.ts')
  replaceExactOnce(
    bindingStorePath,
    'const minStoreLevel = schema2 ? (r.min_store_level as number) : APP_STORE_LEVEL',
    'const minStoreLevel = schema2 ? Math.max(r.min_store_level as number, APP_STORE_LEVEL) : APP_STORE_LEVEL',
    'binding-store parseBinding minStoreLevel promotion',
  )
  replaceExactOnce(
    bindingStorePath,
    'min_store_level: minStoreLevel,',
    'min_store_level: Math.max(minStoreLevel, APP_STORE_LEVEL),',
    'binding-store serializeBinding min_store_level promotion',
  )

  // 3. Allow encrypted store layer in N+1 (minStoreLevel = 3) to read level-2 records written by N' while writing level-3 records.
  const layerPath = join(absRoot, 'apps/shell/src/main/uniwork-sync/store/layer.ts')
  replaceExactOnce(
    layerPath,
    'header.min_store_level >= registration.minStoreLevel &&',
    'header.min_store_level >= 1 &&',
    'encrypted store backward-read compatibility for level-2 records',
  )

  // 4. Upgrade already-migrated level-2 bindings and intent records to APP_STORE_LEVEL (3) when N+1 opens the sync store.
  const migrationPath = join(absRoot, 'apps/shell/src/main/uniwork-sync/migration.ts')
  replaceExactOnce(
    migrationPath,
    '    if (!existsSync(payloadPath)) continue',
    [
      '    if (!existsSync(payloadPath)) {',
      '      const binding = parseBinding(raw)',
      '      if (binding && (raw.schema === 1 || raw.min_store_level !== APP_STORE_LEVEL)) {',
      '        const stored = await intents.get(basename(dir))',
      '        if (stored) {',
      '          await intents.put(basename(dir), stored.intent, stored.payload)',
      '        }',
      '        await rewriteBinding(dir, { ...binding, minStoreLevel: APP_STORE_LEVEL }, deps.appVersion)',
      '        report.migrated += 1',
      '      }',
      '      continue',
      '    }',
    ].join('\n'),
    'migration.ts level-2 -> level-3 store promotion',
  )

  // 5. Set synthetic version (1.0.0-g705n1) in root package.json and apps/shell/package.json.
  for (const relPkg of ['package.json', 'apps/shell/package.json']) {
    const pkgPath = join(absRoot, relPkg)
    const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'))
    pkgJson.version = version
    writeFileSync(pkgPath, `${JSON.stringify(pkgJson, null, 2)}\n`, 'utf8')
  }

  return {
    repoRoot: absRoot,
    version,
    storeLevel: Number(storeLevel),
    patchedFiles: [...N1_PATCHED_FILES],
  }
}

function parseCliArgs(argv) {
  const out = {
    repoRoot: DEFAULT_REPO_ROOT,
    version: '1.0.0-g705n1',
    storeLevel: 3,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--repo-root' && argv[i + 1]) {
      out.repoRoot = resolve(argv[++i])
    } else if (arg === '--version' && argv[i + 1]) {
      out.version = argv[++i]
    } else if (arg === '--store-level' && argv[i + 1]) {
      out.storeLevel = Number(argv[++i])
    }
  }
  return out
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const opts = parseCliArgs(process.argv.slice(2))
  const res = applyN1BuildTimePatch(opts.repoRoot, opts)
  console.log(`[apply-n1-patch] Patched ${res.patchedFiles.length} files in ${res.repoRoot}`)
  console.log(JSON.stringify(res, null, 2))
}
