import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The sheets AI panel mounts the shared Ask UNI panel mode (packages/ui, tested there): the toggle in the
// header actions, the body, the hidden chat pane and the one live region. This only pins the wiring.

const HERE = dirname(fileURLToPath(import.meta.url))

describe('sheets panel wiring (source)', () => {
  const panel = readFileSync(resolve(HERE, '../src/renderer/ai/AiChatPanel.tsx'), 'utf8')

  it('mounts the toggle in the header actions, the body and the hidden chat pane, and routes the live text', () => {
    expect(panel).toMatch(/import \{[^}]*\buseAskUniMode\b[^}]*\} from '@genoffice\/ui'/)
    expect(panel).not.toContain('./ask-uni-mode')
    const header = panel.slice(
      panel.indexOf('className="ai-panel-header-actions"'),
      panel.indexOf('className="ai-panel-header-actions"') + 600,
    )
    expect(header).toContain('<AskUniModeToggle')
    expect(panel).toContain('<AskUniModeBody')
    expect(panel).toContain('{...askUniChatPaneProps(askUni)}')
    expect(panel).toContain('askUniLiveText(askUni, liveText)')
  })

  it("re-reads the binding when the file changes and hides the chat's new-chat button while Ask UNI shows", () => {
    expect(panel).toContain('useAskUniMode(lang, askUniBindingKey)')
    expect(panel).toContain('!askUni.active && (')
  })

  it('keeps one polite live region in the panel render', () => {
    const start = panel.indexOf('ref={asideRef}')
    const render = panel.slice(start, panel.indexOf('</aside>', start))
    expect(render.match(/aria-live="polite"/g)).toHaveLength(1)
  })

  it('keys the binding on the workbook path and its UniWork state (a save to UniWork flips the state, the path may stay)', () => {
    for (const file of [
      '../src/renderer/ai/AiChatPanel.tsx',
      '../src/renderer/ExcelShell.tsx',
      '../src/renderer/App.tsx',
    ]) {
      const src = readFileSync(resolve(HERE, file), 'utf8')
      expect(src, file).toContain('askUniBindingKey')
    }
    const app = readFileSync(resolve(HERE, '../src/renderer/App.tsx'), 'utf8')
    expect(app).toContain(
      "askUniBindingKey: `${workbookFile.path ?? workbookFile.name}|${workbookFile.uniworkBound ? 'u' : 'l'}`",
    )
  })

  it('gets the workbook name from the shell, not from a path or id', () => {
    expect(panel).toContain('askUniDocumentName')
    for (const file of ['../src/renderer/ExcelShell.tsx', '../src/renderer/App.tsx']) {
      const src = readFileSync(resolve(HERE, file), 'utf8')
      expect(src, file).toContain('askUniDocumentName')
    }
  })

  it('leaves Ask UNI when an AI action runs, so the chat that carries the run is on screen', () => {
    expect(panel).toMatch(/\b(askUni\.leave|leaveAskUni)\(\)/)
  })

  it('a refusal replayed on an open panel leaves Ask UNI first, then announces and focuses in the chat composer', () => {
    expect(panel).toMatch(
      /registerBlockedHandler: \(handler\) =>\s*uniworkGate\.registerBlockedHandler\(handler \? \(\) => leaveAskUni\(handler\) : null\)/,
    )
  })
})
