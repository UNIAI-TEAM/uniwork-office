import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { decryptDocument } from '../src/main/pdf-crypt'
import type { getDocument as getDocumentType } from 'pdfjs-dist/legacy/build/pdf.mjs'

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument }))
import { loadPdfForView, withLoadedPdf } from '../src/renderer/open-document'

// A real transferable boundary, like PDF.js handing document data to its worker.
// The reader itself is not needed to exercise the caller's retained bytes.
function workerTakesInput() {
  const channel = new MessageChannel()
  getDocument.mockImplementation(({ data }) => {
    channel.port1.postMessage(data, [data.buffer])
    return { promise: Promise.resolve({ numPages: 2 }) }
  })
  return () => {
    channel.port1.close()
    channel.port2.close()
    getDocument.mockReset()
  }
}

describe('document loading retains source bytes for the open pipeline', () => {
  it.each([
    ['encrc4.pdf', 'user123', 2],
    ['enc-r5-owneronly.pdf', '', 1],
  ])(
    'can still decrypt %s after the view worker takes its input',
    async (file, password, pages) => {
      const bytes = new Uint8Array(readFileSync(join(__dirname, 'fixtures', file)))
      const original = bytes.slice()
      const before = await decryptDocument(original, password)
      const release = workerTakesInput()
      try {
        await loadPdfForView(bytes, password).promise
        const opened = await decryptDocument(bytes, password)
        const parsed = await PDFDocument.load(opened.bytes)
        expect(parsed.getPageCount()).toBe(pages)
        expect(bytes).toEqual(original)
        expect(opened.unlockedAs).toBe(before.unlockedAs)
        expect(opened.permissions).toEqual(before.permissions)
      } finally {
        release()
      }
    },
  )

  it('keeps a plain source usable and forwards the loading task', async () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'plain-sample.pdf')))
    const release = workerTakesInput()
    try {
      const task = loadPdfForView(bytes)
      await expect(task.promise).resolves.toEqual({ numPages: 2 })
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
    } finally {
      release()
    }
  })

  it('forwards the loading task, password and rejection unchanged', async () => {
    const error = new Error('test password failure')
    const task = { promise: Promise.reject(error), destroy: vi.fn() }
    getDocument.mockReturnValueOnce(task)
    const opened = loadPdfForView(new Uint8Array([1, 2, 3]), 'incorrect')
    expect(opened).toBe(task)
    await expect(opened.promise).rejects.toBe(error)
    expect(getDocument.mock.calls[0][0].password).toBe('incorrect')
    getDocument.mockReset()
  })
})

describe('withLoadedPdf (printDoc load path)', () => {
  it.each([
    ['encrc4.pdf', 'user123', 2],
    ['enc-r5-aes256.pdf', 's3cret', 1],
    ['enc-r5-owneronly.pdf', '', 1],
  ])(
    'opens encrypted fixture %s with its stored password and cleans up the loading task',
    async (file, password, expectedPages) => {
      const actual = await vi.importActual<{ getDocument: typeof getDocumentType }>(
        'pdfjs-dist/legacy/build/pdf.mjs',
      )
      getDocument.mockImplementation((opts) => actual.getDocument(opts))
      try {
        const bytes = new Uint8Array(readFileSync(join(__dirname, 'fixtures', file)))
        let destroyed = 0
        const pageCount = await withLoadedPdf(bytes, password, async (doc) => {
          const origDestroy = doc.loadingTask.destroy.bind(doc.loadingTask)
          vi.spyOn(doc.loadingTask, 'destroy').mockImplementation(async () => {
            destroyed++
            await origDestroy()
          })
          const firstPage = await doc.getPage(1)
          expect(firstPage.getViewport({ scale: 1 }).width).toBeGreaterThan(0)
          firstPage.cleanup()
          return doc.numPages
        })
        expect(pageCount).toBe(expectedPages)
        expect(destroyed).toBe(1)
      } finally {
        getDocument.mockReset()
      }
    },
  )

  it('rejects when an encrypted fixture is opened without a password and destroys the failed task', async () => {
    const actual = await vi.importActual<{ getDocument: typeof getDocumentType }>(
      'pdfjs-dist/legacy/build/pdf.mjs',
    )
    let createdTask: { destroy: () => Promise<void> } | undefined
    getDocument.mockImplementation((opts) => {
      const task = actual.getDocument(opts)
      createdTask = task
      vi.spyOn(task, 'destroy')
      return task
    })
    try {
      const bytes = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'enc-r5-aes256.pdf')))
      const run = vi.fn()
      await expect(withLoadedPdf(bytes, null, run)).rejects.toThrow(/password/i)
      expect(run).not.toHaveBeenCalled()
      expect(createdTask?.destroy).toHaveBeenCalledTimes(1)
    } finally {
      getDocument.mockReset()
    }
  })
})
