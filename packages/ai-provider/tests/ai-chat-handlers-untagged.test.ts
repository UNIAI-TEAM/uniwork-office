import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The non-stream `ai:chat` reply is printed as is (Settings > AI test, email AI,
// one-click actions), so its error must never carry the `[[ai-notice:...]]` code
// that only the streamed chat panels strip. The handlers live inside Electron
// main modules, so this guards their source: docs runs the reply in `runAiChat`
// (shared by `ai:chat` and `ai:settings-test`), sheets answers inline.
const ROOT = resolve(__dirname, '../../..')
const DOCS_MAIN = 'apps/docs/src/main/docs-main.ts'
const RUN_AI_CHAT = /const runAiChat = async \(/

function handlerBody(file: string, start: RegExp, end = '\n  })\n'): string {
  const text = readFileSync(resolve(ROOT, file), 'utf8')
  const from = text.search(start)
  expect(from, `${file}: handler start`).toBeGreaterThan(-1)
  const rest = text.slice(from)
  // a handler registered at two-space indent closes with "\n  })", a const arrow with "\n  }"
  const to = rest.indexOf(end)
  expect(to, `${file}: handler end`).toBeGreaterThan(-1)
  return rest.slice(0, to)
}

describe('non-stream ai:chat replies', () => {
  const handlers = [
    { file: DOCS_MAIN, start: RUN_AI_CHAT, end: '\n  }\n' },
    {
      file: 'apps/sheets/src/main/sheets-main.ts',
      start: /ipcMain\.handle\(IPC_CHANNELS\.aiChat,/,
      end: undefined,
    },
  ]

  for (const { file, start, end } of handlers) {
    it(`${file} untags the no-model notice`, () => {
      const body = handlerBody(file, start, end)
      expect(body).toContain('noModelMessage(')
      expect(body).toContain('aiNoticeBody(noModelMessage(')
      expect(body).not.toContain('[[ai-notice:')
    })
  }

  it('docs ai:chat delegates to runAiChat and ai:settings-test reports its errorKind', () => {
    const text = readFileSync(resolve(ROOT, DOCS_MAIN), 'utf8')
    expect(text).toMatch(
      /ipcMain\.handle\('ai:chat', \(_event, request: AiChatRequest\) =>\s*runAiChat\(request\)/,
    )
    // the no-model branch tells the settings pill what to fix instead of leaving a raw string
    const runAiChat = handlerBody(DOCS_MAIN, RUN_AI_CHAT, '\n  }\n')
    expect(runAiChat).toMatch(/aiNoticeBody\(noModelMessage\([^\n]*\n\s*errorKind: 'invalid_key'/)
    const settingsTest = handlerBody(DOCS_MAIN, /ipcMain\.handle\('ai:settings-test'/)
    expect(settingsTest).toContain('await runAiChat(request)')
    expect(settingsTest).toContain('aiTestFailure(result.errorKind ??')
  })
})
