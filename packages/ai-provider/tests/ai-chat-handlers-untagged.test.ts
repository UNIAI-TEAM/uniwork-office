import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The non-stream `ai:chat` reply is printed as is (Settings > AI test, email AI,
// one-click actions), so its error must never carry the `[[ai-notice:...]]` code
// that only the streamed chat panels strip. Both handlers are registered inside
// Electron main modules, so this guards their source.
const ROOT = resolve(__dirname, '../../..')

function handlerBody(file: string, start: RegExp): string {
  const text = readFileSync(resolve(ROOT, file), 'utf8')
  const from = text.search(start)
  expect(from, `${file}: handler start`).toBeGreaterThan(-1)
  const rest = text.slice(from)
  // a handler registered at two-space indent closes with "\n  })"
  const to = rest.indexOf('\n  })\n')
  expect(to, `${file}: handler end`).toBeGreaterThan(-1)
  return rest.slice(0, to)
}

describe('non-stream ai:chat replies', () => {
  const handlers = [
    {
      file: 'apps/docs/src/main/docs-main.ts',
      start: /ipcMain\.handle\('ai:chat'/,
    },
    {
      file: 'apps/sheets/src/main/sheets-main.ts',
      start: /ipcMain\.handle\(IPC_CHANNELS\.aiChat,/,
    },
  ]

  for (const { file, start } of handlers) {
    it(`${file} untags the no-model notice`, () => {
      const body = handlerBody(file, start)
      expect(body).toContain('noModelMessage(')
      expect(body).toContain('aiNoticeBody(noModelMessage(')
      expect(body).not.toContain('[[ai-notice:')
    })
  }
})
