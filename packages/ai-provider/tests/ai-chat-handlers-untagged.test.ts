import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The non-stream `ai:chat` reply is printed as is (Settings > AI test, email AI,
// one-click actions), so its error must never carry the `[[ai-notice:...]]` code
// that only the streamed chat panels strip. The handlers live inside Electron
// main modules, so this guards their source: docs runs the reply in `runAiChat`
// (shared by `ai:chat` and `ai:settings-test`; its provider config comes from
// `chatConfigOf`), sheets answers inline.
const ROOT = resolve(__dirname, '../../..')
const DOCS_MAIN = 'apps/docs/src/main/docs-main.ts'
const SHEETS_MAIN = 'apps/sheets/src/main/sheets-main.ts'
const SLIDES_AI = 'apps/slides/src/main/ai-ipc.ts'
const CHAT_CONFIG_OF = /const chatConfigOf = \(/

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
    { file: DOCS_MAIN, start: CHAT_CONFIG_OF, end: '\n  }\n' },
    {
      file: SHEETS_MAIN,
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
    const chatConfigOf = handlerBody(DOCS_MAIN, CHAT_CONFIG_OF, '\n  }\n')
    expect(chatConfigOf).toMatch(
      /aiNoticeBody\(noModelMessage\([^\n]*\n\s*errorKind: 'invalid_key'/,
    )
    const settingsTest = handlerBody(DOCS_MAIN, /ipcMain\.handle\('ai:settings-test'/)
    expect(settingsTest).toContain('chatConfigOf(request)')
    expect(settingsTest).toContain('aiTestFailure(result.errorKind ??')
  })

  it('the settings test goes through the streamed turn chat uses, not the one-shot request', () => {
    const settingsTest = handlerBody(DOCS_MAIN, /ipcMain\.handle\('ai:settings-test'/)
    expect(settingsTest).toContain('testChatConnection(')
    expect(settingsTest).not.toContain('chatForProvider(')
    // the log keeps the provider text, the pill the kind
    expect(settingsTest).toContain('result.rawError')
  })

  it('every one-shot handler routes failures through the product message', () => {
    for (const file of [DOCS_MAIN, SHEETS_MAIN]) {
      const text = readFileSync(resolve(ROOT, file), 'utf8')
      expect(text, file).toContain('aiChatFailure(result, getUiLang()')
      expect(text, file).toContain('aiChatFailureFromError(err, getUiLang()')
    }
  })
})

// A stream failure reaches the chat panel as an `error` chunk; every handler builds it with
// `aiStreamErrorFields` so a rejected key or a 4xx/5xx body never prints as provider text.
describe('streamed ai:stream failures', () => {
  for (const file of [DOCS_MAIN, SHEETS_MAIN, SLIDES_AI]) {
    it(`${file} sends the product message and logs the raw text`, () => {
      const text = readFileSync(resolve(ROOT, file), 'utf8')
      expect(text).toContain('aiStreamErrorFields(err, getUiLang())')
      expect(text).toMatch(/\[ai-stream\][^\n]*failed:`, raw\)/)
      expect(text).not.toContain('err instanceof AiTimeoutError')
    })
  }
})

// The AI panels ask the cloud status when they open; the plan may have changed on the server since
// the last read, so the handler re-reads before answering.
describe('ai:gsk-status', () => {
  for (const file of [DOCS_MAIN, SHEETS_MAIN, SLIDES_AI]) {
    it(`${file} re-reads the plan before answering`, () => {
      const text = readFileSync(resolve(ROOT, file), 'utf8')
      expect(text).toMatch(/await refreshUniworkCloudStatus\(\)\n\s*if \(!hasGskAuth\(\)\)/)
    })
  }
})
