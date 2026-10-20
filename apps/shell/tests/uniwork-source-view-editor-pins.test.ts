/**
 * UNI-1993 slice B: the state a "source view" path reports to every editor —
 * bound, read-only AND locked, with no document behind it (an attachment of a
 * chat / task / meeting / email shown view-only) — is already enforced by the
 * six modules' existing view-only gates. This pins the COMBINED state per
 * editor so a later change to one flag cannot quietly reopen a write path.
 *
 * Already pinned elsewhere and deliberately not repeated here:
 *  - Save As / Export / Print / image export refuse a locked path in every
 *    editor with isBound+isReadOnly+isLocked all true:
 *    uniwork-docs-export-lock.test.ts ("every export / Save As / print entry
 *    point refuses a locked source").
 *  - The assistant of a view-only document keeps read tools only: each app's
 *    tests/uniwork-view-only-ai.test.ts.
 *  - The edit surface of a view-only document is locked: sheets
 *    view-only-guard / uniwork-view-only-load, markdown + html
 *    uniwork-view-only-app, docs uniwork-view-only-clean, slides + pdf
 *    uniwork-view-only-ai / uniwork-save.
 *
 * What was missing is the pure save gate answering for the full state: every
 * origin and mode (explicit Save, AutoSave, capture, agent save-to, Save As
 * onto itself) writes nothing and reports no user save, even when a one-shot
 * capture is armed, while an ordinary local path next to it stays untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as docs from '../../docs/src/main/uniwork-policy'
import * as sheets from '../../sheets/src/main/uniwork-policy'
import * as slides from '../../slides/src/main/uniwork-policy'
import * as pdf from '../../pdf/src/main/uniwork-policy'
import * as markdown from '../../markdown/src/main/uniwork-policy'
import * as html from '../../html/src/main/uniwork-policy'

const SRC = '/u/uniwork-drafts-preview/sources-s1/chat-42/Plan.docx'
const OTHER = '/home/me/Documents/notes.txt'

interface Policy {
  isBound(path: string): boolean
  isReadOnly(path: string): boolean
  isLocked?(path: string): boolean
  consumeCapture?(path: string): boolean
  readOnlySave?(path: string): void
}
interface Verdict {
  write: boolean
  fireHook: boolean
}
interface Editor {
  name: string
  module: {
    setUniworkDocumentPolicy(next: Policy | null): void
    uniworkIsBound(path: string | null | undefined): boolean
    uniworkIsReadOnly(path: string | null | undefined): boolean
    uniworkIsLocked(path: string | null | undefined): boolean
    uniworkReadOnlySave(path: string | null | undefined): void
    setUniworkUserSaveHook(hook: ((path: string) => void) | null): void
  }
  /** every way a save can reach `target`, as the module's own gate is asked */
  attempts(target: string): Array<[string, Verdict]>
}

const EDITORS: Editor[] = [
  {
    name: 'docs',
    module: docs,
    attempts: (target) =>
      (['user', 'auto', 'capture', 'mcp', 'save-as', 'save-new'] as const).map((origin) => [
        origin,
        docs.uniworkSaveDecision(origin, target),
      ]),
  },
  {
    name: 'sheets',
    module: sheets,
    attempts: (target) => [
      [
        'user save',
        sheets.uniworkSaveDecision({
          mode: 'save',
          origin: 'user',
          documentPath: target,
          targetPath: target,
          mcp: false,
        }),
      ],
      [
        'autosave',
        sheets.uniworkSaveDecision({
          mode: 'save',
          origin: 'auto',
          documentPath: target,
          targetPath: target,
          mcp: false,
        }),
      ],
      [
        'capture',
        sheets.uniworkSaveDecision({
          mode: 'save',
          origin: 'capture',
          documentPath: target,
          targetPath: target,
          mcp: false,
        }),
      ],
      [
        'no origin',
        sheets.uniworkSaveDecision({
          mode: 'save',
          origin: undefined,
          documentPath: target,
          targetPath: target,
          mcp: false,
        }),
      ],
      [
        'agent save-to',
        sheets.uniworkSaveDecision({
          mode: 'save',
          origin: 'user',
          documentPath: target,
          targetPath: target,
          mcp: true,
        }),
      ],
      [
        'save-as onto itself',
        sheets.uniworkSaveDecision({
          mode: 'save-as',
          origin: 'user',
          documentPath: target,
          targetPath: target,
          mcp: false,
        }),
      ],
    ],
  },
  {
    name: 'slides',
    module: slides,
    attempts: (target) =>
      (
        [
          ['user save', 'save', 'user'],
          ['autosave', 'save', 'auto'],
          ['capture', 'save', 'capture'],
          ['agent save-to', 'mcp', 'user'],
          ['save-as onto itself', 'save-as', 'user'],
        ] as const
      ).map(([label, kind, origin]) => [
        label,
        slides.uniworkSaveDecision({ kind, origin, currentPath: target, targetPath: target }),
      ]),
  },
  {
    name: 'pdf',
    module: pdf,
    attempts: (target) =>
      (
        [
          ['user save', 'user', false],
          ['autosave', 'auto', false],
          ['internal flush', 'internal', false],
          ['capture', 'capture', false],
          ['no origin', undefined, false],
          ['save-as onto itself', undefined, true],
        ] as const
      ).map(([label, origin, saveAs]) => [
        label,
        pdf.uniworkSaveDecision({ origin, currentPath: target, targetPath: target, saveAs }),
      ]),
  },
  {
    name: 'markdown',
    module: markdown,
    attempts: (target) => textEditorAttempts(markdown.uniworkSaveDecision, target),
  },
  {
    name: 'html',
    module: html,
    attempts: (target) => textEditorAttempts(html.uniworkSaveDecision, target),
  },
]

type TextSaveInput = Parameters<typeof markdown.uniworkSaveDecision>[0]

function textEditorAttempts(
  decide: (input: TextSaveInput) => Verdict,
  target: string,
): Array<[string, Verdict]> {
  const base = { currentPath: target, targetPath: target }
  return [
    ['user save', decide({ ...base, mode: 'save', origin: 'user' })],
    ['autosave', decide({ ...base, mode: 'save', origin: 'auto' })],
    ['capture', decide({ ...base, mode: 'save', origin: 'capture' })],
    ['no origin', decide({ ...base, mode: 'save' })],
    ['agent save-to', decide({ ...base, mode: 'save', mcp: true })],
    ['save-as onto itself', decide({ ...base, mode: 'saveAs', origin: 'user' })],
  ]
}

/** What a source view path reports: bound + read-only + locked; every other path is a plain file. */
function sourceViewPolicy(extra: Partial<Policy> = {}): Policy {
  return {
    isBound: (path) => path === SRC,
    isReadOnly: (path) => path === SRC,
    isLocked: (path) => path === SRC,
    ...extra,
  }
}

afterEach(() => {
  for (const { module } of EDITORS) {
    module.setUniworkDocumentPolicy(null)
    module.setUniworkUserSaveHook(null)
  }
})

describe.each(EDITORS)('$name: a source view path (bound + read-only + locked)', (editor) => {
  it('reports bound, read-only and locked for that path only', () => {
    editor.module.setUniworkDocumentPolicy(sourceViewPolicy())
    expect(editor.module.uniworkIsBound(SRC)).toBe(true)
    expect(editor.module.uniworkIsReadOnly(SRC)).toBe(true)
    expect(editor.module.uniworkIsLocked(SRC)).toBe(true)
    expect(editor.module.uniworkIsBound(OTHER)).toBe(false)
    expect(editor.module.uniworkIsReadOnly(OTHER)).toBe(false)
    expect(editor.module.uniworkIsLocked(OTHER)).toBe(false)
  })

  it('writes nothing and reports no user save for any origin or mode', () => {
    editor.module.setUniworkDocumentPolicy(sourceViewPolicy())
    const hook = vi.fn()
    editor.module.setUniworkUserSaveHook(hook)
    const attempts = editor.attempts(SRC)
    expect(attempts.length).toBeGreaterThanOrEqual(5)
    for (const [label, verdict] of attempts) {
      expect(verdict, `${editor.name} ${label}`).toMatchObject({ write: false, fireHook: false })
    }
    expect(hook).not.toHaveBeenCalled()
  })

  it('an armed one-shot capture cannot write it either', () => {
    const consumeCapture = vi.fn(() => true)
    editor.module.setUniworkDocumentPolicy(sourceViewPolicy({ consumeCapture }))
    for (const [label, verdict] of editor.attempts(SRC)) {
      expect(verdict, `${editor.name} ${label}`).toMatchObject({ write: false, fireHook: false })
    }
  })

  it('an ordinary local path next to it still saves as before', () => {
    editor.module.setUniworkDocumentPolicy(sourceViewPolicy())
    const attempts = editor.attempts(OTHER)
    const userSave = attempts.find(([label]) => /^user/.test(label))
    expect(userSave?.[1].write).toBe(true)
  })

  it('forwards an explicit Save to the explain hook for that path, and survives a throwing hook', () => {
    const readOnlySave = vi.fn()
    editor.module.setUniworkDocumentPolicy(sourceViewPolicy({ readOnlySave }))
    editor.module.uniworkReadOnlySave(SRC)
    expect(readOnlySave).toHaveBeenCalledTimes(1)
    expect(readOnlySave).toHaveBeenCalledWith(SRC)

    editor.module.setUniworkDocumentPolicy(
      sourceViewPolicy({
        readOnlySave: () => {
          throw new Error('toast failed')
        },
      }),
    )
    expect(() => editor.module.uniworkReadOnlySave(SRC)).not.toThrow()
  })

  it('a policy that stops answering (sign-out) leaves the path an unbound plain file for this module', () => {
    editor.module.setUniworkDocumentPolicy(sourceViewPolicy())
    editor.module.setUniworkDocumentPolicy(null)
    expect(editor.module.uniworkIsBound(SRC)).toBe(false)
    expect(editor.module.uniworkIsReadOnly(SRC)).toBe(false)
    expect(editor.module.uniworkIsLocked(SRC)).toBe(false)
  })
})

describe('pdf: page tools and other in-place rewrites', () => {
  it('refuse the source view path and leave a local path alone', () => {
    pdf.setUniworkDocumentPolicy(sourceViewPolicy())
    expect(pdf.uniworkMayRewriteInPlace(SRC)).toBe(false)
    expect(pdf.uniworkMayRewriteInPlace(OTHER)).toBe(true)
  })
})
