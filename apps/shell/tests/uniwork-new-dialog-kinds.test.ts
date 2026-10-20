import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NEW_KIND_LABEL_KEY } from '../src/renderer/src/UniworkDocActions'
import * as model from '../src/renderer/src/uniwork-docs-model'
import { strings } from '../src/renderer/src/strings'

/**
 * UNI-2046 F1: Plain text lives only in the New menu. The UniWork Open dialog's
 * "New document" form must not list it, or two radios would both read "Văn bản" in vi.
 */
describe('New document dialog kinds', () => {
  const dialogKinds = (model as { NEW_DIALOG_FORMATS?: readonly string[] }).NEW_DIALOG_FORMATS ?? []

  it('has no txt, while the New menu formats keep it', () => {
    expect(dialogKinds.length).toBeGreaterThan(0)
    expect(dialogKinds).not.toContain('txt')
    expect(model.NEW_DOC_FORMATS).toContain('txt')
  })

  it('shows a unique vi label per kind', () => {
    const labels = dialogKinds.map(
      (kind) =>
        (strings.vi as Record<string, string>)[
          NEW_KIND_LABEL_KEY[kind as keyof typeof NEW_KIND_LABEL_KEY]
        ],
    )
    expect(labels.every(Boolean)).toBe(true)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('is what the Open dialog passes to the New document form', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../src/renderer/src/UniworkOpenDialog.tsx'),
      'utf8',
    )
    expect(source).toContain('kinds={NEW_DIALOG_FORMATS}')
    expect(source).not.toContain('kinds={NEW_DOC_FORMATS}')
  })
})
