import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The deck saves — Ctrl+S, Save As, autosave and the MCP save — live in the
 * Electron main module, which no unit test can import without standing up the
 * whole editor. savePptxToFile streams into the path it is given and truncates
 * it first, so a deck saved onto its own path is cut off for as long as the
 * stream runs and stays cut off if the process dies (#2123). Every save has to
 * hand it the sibling temp that atomicWriteVia renames over the deck afterwards.
 */
describe('deck saves in the Slides main and Electron HostIO modules', () => {
  const mainSource = readFileSync(join(import.meta.dirname, '../src/main/slides-main.ts'), 'utf8')
  const hostSource = readFileSync(
    join(import.meta.dirname, '../src/main/electron-host-io.ts'),
    'utf8',
  )

  it('stream the package into the temp that atomicWriteVia publishes', () => {
    expect(mainSource).toContain(
      "import { atomicWriteVia } from '@genoffice/electron-utils/atomic-write'",
    )
    expect(mainSource).toContain('atomicWriteVia(filePath, (tmp) => savePptxToFile(opened, tmp))')
    expect(hostSource).toContain(
      "import { atomicWriteVia } from '@genoffice/electron-utils/atomic-write'",
    )
    expect(hostSource).toContain('atomicWriteVia(target, (tmp) => savePptxToFile(opened, tmp))')
  })

  it("never hand savePptxToFile the deck's own path", () => {
    expect(mainSource.match(/savePptxToFile\([^)]*\)/g)).toEqual(['savePptxToFile(opened, tmp)'])
    expect(hostSource.match(/savePptxToFile\([^)]*\)/g)).toEqual(['savePptxToFile(opened, tmp)'])
    // MCP save + autosave in slides-main (Ctrl+S and Save As go through HostIO.writeDeck)
    expect(mainSource.match(/await writeDeckFile\(session\.opened, /g)).toHaveLength(2)
  })
})
