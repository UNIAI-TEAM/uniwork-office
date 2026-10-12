/**
 * G6-12 URL fetch (markdown insert_image; remote images in the DOCX export):
 * the renderer only hands http(s) URLs to the bridge, the bridge channel is the
 * shell-wide `ai:fetch-image` handler (docs-main: SSRF guard + 50 MB cap,
 * pinned in apps/docs/tests/g6-12-url-fetch-guard.test.ts), and the markdown
 * main process reads export images through the same electron-utils guard and
 * cap. `fetch` is stubbed: no request leaves the machine. The URL policy is
 * unchanged (Product question); this only pins the guard.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { MAX_REMOTE_IMAGE_BYTES, fetchRemoteImage, readBodyCapped } from '@genoffice/electron-utils'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { executeTool, markDocSeen } from '../src/renderer/ai/tools'
import { AI_CHANNELS } from '../src/shared/ipc'

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
  vi.unstubAllGlobals()
})

function createEditor(): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: {
        onOpen: () => {},
        onUpdate: () => {},
        onKeyDown: () => false,
        onClose: () => {},
      },
      slashItems: () => [],
    }),
    content: '',
  })
  editor.commands.setContent('Body', { contentType: 'markdown' })
  markDocSeen(editor)
  editors.push(editor)
  return editor
}

describe('markdown insert_image hands only http(s) URLs to the guarded bridge', () => {
  it('refuses other schemes before any download', async () => {
    const fetchImage = vi.fn(async () => null)
    vi.stubGlobal('markdownApi', { fetchImage, saveImage: vi.fn() })
    const editor = createEditor()
    for (const url of [
      'file:///etc/passwd',
      'ftp://93.184.216.34/a.png',
      'data:image/png;base64,iVBORw0KGgo=',
      'javascript:alert(1)',
      '/abs/local/path.png',
    ]) {
      const exec = await executeTool(editor, { id: 't', name: 'insert_image', input: { url } })
      expect(exec.isError, url).toBe(true)
    }
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('uses the shell-wide ai:fetch-image channel; markdown main registers no unguarded twin', () => {
    expect(AI_CHANNELS.fetchImage).toBe('ai:fetch-image')
    const mainDir = join(__dirname, '../src/main')
    for (const file of readdirSync(mainDir).filter((f) => f.endsWith('.ts'))) {
      expect(readFileSync(join(mainDir, file), 'utf8'), file).not.toMatch(/['"]ai:fetch-image['"]/)
    }
  })
})

describe('markdown main remote images keep the electron-utils guard and cap', () => {
  it('refuses private and non-http targets without a request', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }))
    for (const url of [
      'http://127.0.0.1/a.png',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.1.2.3/a.png',
      'http://[::1]/a.png',
      'http://localhost/a.png',
      'ftp://93.184.216.34/a.png',
    ]) {
      expect(await fetchRemoteImage(url, { fetchImpl: fetchMock }), url).toBeNull()
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caps the body at 50 MB', async () => {
    expect(MAX_REMOTE_IMAGE_BYTES).toBe(50 * 1024 * 1024)
    const declared = new Response(new Uint8Array([1]), {
      headers: { 'content-length': String(MAX_REMOTE_IMAGE_BYTES + 1) },
    })
    await expect(readBodyCapped(declared, MAX_REMOTE_IMAGE_BYTES)).rejects.toThrow(/larger than/)
  })

  it('the markdown main process reads remote images through fetchRemoteImage + readBodyCapped', () => {
    const src = readFileSync(join(__dirname, '../src/main/markdown-main.ts'), 'utf8')
    const fn = src.slice(src.indexOf('async function readRemoteImage('))
    const body = fn.slice(0, fn.indexOf('\n}\n'))
    expect(body).toContain('fetchRemoteImage(url)')
    expect(body).toContain('readBodyCapped(resp, MAX_REMOTE_IMAGE_BYTES)')
    expect(body).not.toMatch(/\bnet\.fetch\(|\bfetch\(/)
  })
})
