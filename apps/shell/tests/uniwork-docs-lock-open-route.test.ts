import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UNIWORK_DOC_CHANNELS, UNIWORK_LOCK_REASONS } from '../src/shared/home-api'

/**
 * G5-04g: every open route (File > Open, recents, argv/open-with, drag, the MCP
 * open tool, the launch flow) goes through routeDocumentPath, so the guard is
 * installed there once — before any module is asked to open the path — and the
 * service's own openPath in the wiring refuses as well. The shell never treats
 * such a path as a plain local file: no module, no "unsupported" dialog.
 * The decision itself (refuseLockedOpenPath) is exercised at runtime in
 * uniwork-docs-lock-guard.test.ts; this file pins where the router calls it.
 */

const read = (relative: string) =>
  readFileSync(join(__dirname, '..', relative), 'utf8').replace(/\r\n/g, '\n')

describe('the shell open router (G5-04g)', () => {
  it('routeDocumentPath refuses a locked path before it routes to a module', () => {
    const source = read('src/main/index.ts')
    const route = source.slice(source.indexOf('function routeDocumentPath('))
    const guard = route.indexOf('refuseLockedOpenPath(uniworkDocs?.service, filePath)')
    const exists = route.indexOf('if (!existsSync(filePath)) return false')
    const firstModule = route.indexOf('tabManager.openDocsTab(filePath)')
    expect(guard).toBeGreaterThan(-1)
    // refused before the existence check, and long before any module opens
    expect(guard).toBeLessThan(exists)
    expect(guard).toBeLessThan(firstModule)
    expect(route).toMatch(
      /if \(refuseLockedOpenPath\(uniworkDocs\?\.service, filePath\)\) return false/,
    )
    // the funnel decision is imported, not re-implemented here
    expect(source).toMatch(/import \{ refuseLockedOpenPath \} from '\.\/uniwork-docs\/service'/)
  })

  it('the UniWork service wiring passes the guard through and the shell hook exists', () => {
    const source = read('src/main/index.ts')
    expect(source).toMatch(
      /refuseLockedPath: \(path: string\) => refuseLockedOpenPath\(uniworkDocs\?\.service, path\)/,
    )
  })

  it('the wiring refuses inside the service openPath and registers both invoke handlers', () => {
    const source = read('src/main/uniwork-docs/wiring.ts')
    expect(source).toMatch(/if \(wiring\.refuseLockedPath\(path\)\) return false/)
    expect(source).toMatch(/ipcMain\.handle\(UNIWORK_DOC_CHANNELS\.locks,/)
    expect(source).toMatch(/ipcMain\.handle\(UNIWORK_DOC_CHANNELS\.dismissLock,/)
    // the lock pushes through the generic holder, typed to the lock payload
    // (whitespace-flexible: prettier may wrap the arguments)
    expect(source).toMatch(
      /pushLock: createPushHolder<UniworkDocLock>\(\s*\(\) => wiring\.shellContents\(\),\s*UNIWORK_DOC_CHANNELS\.lock,?\s*\)/,
    )
    // the launch event keeps its own instantiation
    expect(source).toMatch(
      /pushLaunch: createLaunchPusher\(\(\) => wiring\.shellContents\(\), UNIWORK_DOC_CHANNELS\.launchEvent\)/,
    )
  })

  it('the preload exposes the three lock methods on the shared channels', () => {
    const source = read('src/preload/index.ts')
    expect(source).toMatch(/onUniworkLock\(cb\)/)
    expect(source).toMatch(/async uniworkLocks\(\)/)
    expect(source).toMatch(/async dismissUniworkLock\(path\)/)
    expect(source).toMatch(/ipcRenderer\.invoke\(UNIWORK_DOC_CHANNELS\.locks\)/)
    expect(source).toMatch(/ipcRenderer\.invoke\(UNIWORK_DOC_CHANNELS\.dismissLock, path\)/)
    expect(source).toMatch(/ipcRenderer\.on\(UNIWORK_DOC_CHANNELS\.lock,/)
  })

  it('the preload does not replay a held lock to a late subscriber (R1-be-1)', () => {
    const source = read('src/preload/index.ts')
    // a lock is a plain fan-out to the subscribers present; unlike a launch
    // event it is NOT held for the first subscriber, so a lock the user
    // dismissed is never resurrected (the shell reads uniworkLocks() on mount)
    expect(source).toMatch(/const uniworkLockSubscribers = new Set</)
    expect(source).not.toMatch(/createLaunchReplay<UniworkDocLock>/)
    // and the wiring comment says so, matching this behaviour
    const wiring = read('src/main/uniwork-docs/wiring.ts')
    expect(wiring).toMatch(/The preload does NOT replay a held lock/)
  })

  it('the channel names match the lane contract exactly', () => {
    expect(UNIWORK_DOC_CHANNELS.lock).toBe('uniwork-doc:lock')
    expect(UNIWORK_DOC_CHANNELS.locks).toBe('uniwork-doc:locks')
    expect(UNIWORK_DOC_CHANNELS.dismissLock).toBe('uniwork-doc:dismiss-lock')
  })

  it('the preload exposes the lock list push and keeps keystore locks (R1-fe-1 BE)', () => {
    const source = read('src/preload/index.ts')
    // the whole list when main clears a keystore lock (a Retry that worked)
    expect(source).toMatch(/onUniworkLocksChanged\(cb\)/)
    expect(source).toMatch(/ipcRenderer\.on\(UNIWORK_DOC_CHANNELS\.locksChanged,/)
    // the validator must not drop a keystore_locked lock on the way to the shell:
    // it accepts from the shared reason list (not an inline whitelist), and that
    // list carries keystore_locked. Behaviour of the guard itself is exercised in
    // uniwork-lock-preload-guard.test.ts.
    expect(source).toMatch(/UNIWORK_LOCK_REASON_SET[^\n]*UNIWORK_LOCK_REASONS/)
    expect(UNIWORK_LOCK_REASONS).toContain('keystore_locked')
    expect(UNIWORK_DOC_CHANNELS.locksChanged).toBe('uniwork-doc:locks-changed')
    // the wiring pushes the current list on that channel
    const wiring = read('src/main/uniwork-docs/wiring.ts')
    expect(wiring).toMatch(
      /pushLocks: \(\) => push\(UNIWORK_DOC_CHANNELS\.locksChanged, service\.currentLocks\(\)\)/,
    )
  })
})
