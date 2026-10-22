import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The docs AI panel mounts the shared Ask UNI panel mode (packages/ui, tested there): the toggle in the
// header actions, the body, the hidden chat pane and the one live region. This only pins the wiring.

const HERE = dirname(fileURLToPath(import.meta.url))

describe('docs panel wiring (source)', () => {
  const panel = readFileSync(resolve(HERE, '../src/renderer/ai/AiPanel.tsx'), 'utf8')

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
    expect(panel).toContain('useAskUniMode(lang, filePath)')
    expect(panel).toContain('!askUni.active && (')
  })

  it('keeps one polite live region in the panel render', () => {
    const start = panel.indexOf('ref={asideRef}')
    const render = panel.slice(start, panel.indexOf('</aside>', start))
    expect(render.match(/aria-live="polite"/g)).toHaveLength(1)
  })

  it('names the file by its base name only', () => {
    expect(panel).toContain('askUniFileName(filePath')
  })

  it('leaves Ask UNI when an AI action runs, so the chat that carries the run is on screen', () => {
    expect(panel).toMatch(/\b(askUni\.leave|leaveAskUni)\(\)/)
  })

  it('focuses the prefilled composer only after Ask UNI has left (the chat pane is hidden until then)', () => {
    expect(panel).toContain(
      'askUni.leave(preset.autoRun ? undefined : () => inputRef.current?.focus())',
    )
  })
})
