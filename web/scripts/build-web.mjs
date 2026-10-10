// `npm run build:web [-- --module <m>]` / `npm run build:web:all` (GO-B4/B5/B6).
//
// Runs `vite build --config web/docs/vite.config.ts` once per module with WEB_MODULE set (Vite's CLI
// has no --module flag, so the module travels in the environment). Without --module: WEB_MODULE,
// else docs, i.e. exactly the old `build:web`. --all builds every module of the registry in order,
// one at a time (each build is a separate process: a 4-CPU host must not run them in parallel).
// Modules: web/docs/build/modules.ts (WEB_MODULE_NAMES below mirrors it; build.test.ts checks that).
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WEB_MODULE_NAMES = ['docs', 'pdf', 'markdown', 'html', 'slides', 'sheets']

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')

/** @returns {{ modules: string[], viteArgs: string[] }} */
export function parseArgs(argv, env = process.env) {
  const viteArgs = []
  let modules = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--all') modules = [...WEB_MODULE_NAMES]
    else if (arg === '--module') modules = [argv[++i]]
    else if (arg.startsWith('--module=')) modules = [arg.slice('--module='.length)]
    else viteArgs.push(arg)
  }
  modules ??= [env.WEB_MODULE || 'docs']
  for (const m of modules) {
    if (!WEB_MODULE_NAMES.includes(m)) {
      throw new Error(`unknown web module "${m}" (one of: ${WEB_MODULE_NAMES.join(', ')})`)
    }
  }
  if (modules.length > 1 && env.WEB_DOCS_OUT_DIR) {
    throw new Error('WEB_DOCS_OUT_DIR names one directory; it cannot be used with --all')
  }
  return { modules, viteArgs }
}

function main() {
  const { modules, viteArgs } = parseArgs(process.argv.slice(2))
  const vite = resolve(repoRoot, 'node_modules/vite/bin/vite.js')
  for (const module of modules) {
    console.log(`\n== build:web --module ${module}`)
    const r = spawnSync(
      process.execPath,
      [vite, 'build', '--config', 'web/docs/vite.config.ts', ...viteArgs],
      { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, WEB_MODULE: module } },
    )
    if (r.status !== 0) {
      console.error(`build:web --module ${module} failed (exit ${r.status ?? r.signal})`)
      process.exit(r.status || 1)
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e))
    process.exit(1)
  }
}
