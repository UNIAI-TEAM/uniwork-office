/**
 * UniWork document seam in docs: the pure save decision and how the renderer gates
 * autosave / view-only saves. The real docs:save / save-as / save-to handlers are
 * driven in uniwork-save-handler.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  notifyUniworkUserSave,
  setUniworkDocumentPolicy,
  setUniworkUserSaveHook,
  uniworkDocState,
  uniworkSamePath,
  uniworkSaveDecision,
  type UniworkSaveOrigin,
} from '../src/main/uniwork-policy'
import {
  NO_UNIWORK_STATE,
  uniworkAllowsSave,
  uniworkStateFor,
} from '../src/renderer/uniwork-doc-state'

const BOUND = 'C:/u/uniwork-documents/dep/user/doc1/report.docx'
const VIEW = 'C:/u/uniwork-documents/dep/user/doc2/minutes.docx'
const LOCAL = 'C:/Users/me/Documents/notes.docx'

function installPolicy(): void {
  setUniworkDocumentPolicy({
    isBound: (p) => p === BOUND || p === VIEW,
    isReadOnly: (p) => p === VIEW,
  })
}

/** what the docs:save / save-as / save-to handlers do with a decision */
function simulateSave(origin: UniworkSaveOrigin, path: string, write: (p: string) => void) {
  const decision = uniworkSaveDecision(origin, path)
  if (!decision.write) return decision
  write(path)
  if (decision.fireHook) notifyUniworkUserSave(path)
  return decision
}

afterEach(() => {
  setUniworkDocumentPolicy(null)
  setUniworkUserSaveHook(null)
})

describe('uniworkSaveDecision (main)', () => {
  it('fires the user-save hook exactly once for an explicit Save onto a bound path', () => {
    installPolicy()
    const hook = vi.fn()
    const write = vi.fn()
    setUniworkUserSaveHook(hook)
    simulateSave('user', BOUND, write)
    expect(write).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith(BOUND)
  })

  it.each<UniworkSaveOrigin>(['auto', 'save-as', 'save-new', 'mcp'])(
    'never fires the hook for a %s save',
    (origin) => {
      installPolicy()
      const hook = vi.fn()
      setUniworkUserSaveHook(hook)
      simulateSave(origin, LOCAL, vi.fn())
      simulateSave(origin, BOUND, vi.fn())
      expect(hook).not.toHaveBeenCalled()
    },
  )

  it('refuses autosave onto a bound path without writing', () => {
    installPolicy()
    const write = vi.fn()
    const d = simulateSave('auto', BOUND, write)
    expect(d).toEqual({ write: false, fireHook: false, reason: 'uniwork-bound' })
    expect(write).not.toHaveBeenCalled()
  })

  it('refuses every write to a view-only path (no write, no hook)', () => {
    installPolicy()
    const hook = vi.fn()
    setUniworkUserSaveHook(hook)
    for (const origin of ['user', 'auto', 'save-as', 'save-new', 'mcp'] as const) {
      const write = vi.fn()
      const d = simulateSave(origin, VIEW, write)
      expect(d.write).toBe(false)
      expect(d.reason).toBe('uniwork-read-only')
      expect(write).not.toHaveBeenCalled()
    }
    expect(hook).not.toHaveBeenCalled()
  })

  it('a Save As that picks the open file is judged as the explicit Save it is', () => {
    installPolicy()
    // the handler asks as 'user' when the dialog's pick is the document's own file
    expect(uniworkSaveDecision('user', BOUND)).toEqual({ write: true, fireHook: true })
    expect(uniworkSaveDecision('user', VIEW).write).toBe(false)
  })

  it('lets Save As from a view-only document land on another, plain path', () => {
    installPolicy()
    expect(uniworkSaveDecision('save-as', LOCAL)).toEqual({ write: true, fireHook: false })
  })

  it('keeps autosave of an unbound path unchanged', () => {
    installPolicy()
    expect(uniworkSaveDecision('auto', LOCAL)).toEqual({ write: true, fireHook: false })
  })

  it('with no policy every save writes, and the null hook is inert', () => {
    for (const origin of ['user', 'auto', 'save-as', 'save-new', 'mcp'] as const) {
      expect(uniworkSaveDecision(origin, BOUND).write).toBe(true)
    }
    expect(() => notifyUniworkUserSave(BOUND)).not.toThrow()
    expect(uniworkDocState(BOUND)).toEqual({ bound: false, readOnly: false })
  })

  it('reports bound / read-only state for the renderer query', () => {
    installPolicy()
    expect(uniworkDocState(BOUND)).toEqual({ bound: true, readOnly: false })
    expect(uniworkDocState(VIEW)).toEqual({ bound: true, readOnly: true })
    expect(uniworkDocState(LOCAL)).toEqual({ bound: false, readOnly: false })
  })
})

describe('renderer save gate', () => {
  const bound = { path: BOUND, bound: true, readOnly: false }
  const view = { path: VIEW, bound: true, readOnly: true }

  it('forces autosave off for a bound document but lets explicit Save through', () => {
    const s = uniworkStateFor(bound, BOUND)
    expect(uniworkAllowsSave(s, false, true)).toBe(false)
    expect(uniworkAllowsSave(s, false, false)).toBe(true)
  })

  it('blocks in-place Save of a view-only document, keeps Save As', () => {
    const s = uniworkStateFor(view, VIEW)
    expect(uniworkAllowsSave(s, false, false)).toBe(false)
    expect(uniworkAllowsSave(s, false, true)).toBe(false)
    expect(uniworkAllowsSave(s, true, false)).toBe(true)
  })

  it('ignores an answer that belongs to another path (renamed / saved-as)', () => {
    expect(uniworkStateFor(view, LOCAL)).toEqual({ bound: false, readOnly: false })
    expect(uniworkStateFor(NO_UNIWORK_STATE, null)).toEqual({ bound: false, readOnly: false })
    expect(uniworkAllowsSave(uniworkStateFor(view, LOCAL), false, true)).toBe(true)
  })
})

describe('uniworkSamePath', () => {
  it('matches the same file however the dialog spells it', () => {
    expect(uniworkSamePath(BOUND, BOUND)).toBe(true)
    // Windows paths are case-insensitive; elsewhere they are not
    expect(uniworkSamePath(BOUND, BOUND.toUpperCase())).toBe(process.platform === 'win32')
    expect(uniworkSamePath(BOUND, LOCAL)).toBe(false)
    expect(uniworkSamePath(null, BOUND)).toBe(false)
    expect(uniworkSamePath(BOUND, undefined)).toBe(false)
  })
})
