/**
 * The Linux default `monospace` (DejaVu Sans Mono) puts Vietnamese combining marks and the
 * ắ/ằ family in the wrong place (visual r2 MK-09). Every mono stack of the editor therefore
 * lists fonts that carry the Vietnamese letters before the generic family.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const FILES = [
  'markdown/src/renderer/styles.css',
  'markdown/src/renderer/source/PlainTextEditor.tsx',
  'html/src/renderer/styles.css',
  'html/src/renderer/source/cm-setup.ts',
]

/** every font declaration whose stack ends in the generic `monospace` (not `ui-monospace`) */
function monoStacks(source: string): string[] {
  return [...source.matchAll(/(?:font-family:|font:|fontFamily:)[^;}]*?(?<![-\w])monospace/g)].map(
    (m) => m[0],
  )
}

describe('mono font stacks keep Vietnamese marks right', () => {
  for (const file of FILES) {
    it(file, () => {
      const stacks = monoStacks(readFileSync(join(ROOT, file), 'utf8'))
      expect(stacks.length).toBeGreaterThan(0)
      for (const stack of stacks) {
        expect(stack, stack).toMatch(/Noto Sans Mono[\s\S]*Liberation Mono[\s\S]*monospace/)
      }
    })
  }
})
