// G6-12 #5: resolve_comment, set_header_footer, define_style, set_page_setup and
// set_watermark change the document (state saved beside the ProseMirror tree), so
// they declare mutated: true; the agent loop then snapshots before them.
import { afterEach, describe, expect, it } from 'vitest'
import { RUNS, call, createEditor, destroyEditors, fixture } from './helpers/g6-12-side-fixture'

afterEach(destroyEditors)

describe('side-state tools declare mutated: true', () => {
  for (const [name, input] of RUNS) {
    it(name, async () => {
      const { access } = fixture()
      const exec = await call(createEditor(), name, input, access)
      expect(exec.isError, exec.output).toBeFalsy()
      expect(exec.mutated).toBe(true)
    })
  }
})
