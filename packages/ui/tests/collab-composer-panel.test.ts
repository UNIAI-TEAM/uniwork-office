/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollabComposer } from '../src/collab/CollabComposer'
import { CollabPanel } from '../src/collab/CollabPanel'
import { loadDraft } from '../src/collab/draft-store'
import { COLLAB_LIVE_REGION_ID } from '../src/collab/live-region'
import { useCollabThreads } from '../src/collab/use-collab-threads'
import { COMPOSER_STRINGS } from './collab-composer-fixtures'
import { EN, err, fakeSource, flush, host, list } from './collab-kit'

let el: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  sessionStorage.clear()
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
})

afterEach(() => {
  act(() => root.unmount())
  el.remove()
  document.getElementById(COLLAB_LIVE_REGION_ID)?.remove()
  vi.unstubAllGlobals()
})

const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!

function Harness({ source }: { source: ReturnType<typeof fakeSource> }) {
  const h = host({ kind: 'discussion' })
  const controller = useCollabThreads(source, h, { strings: EN })
  return createElement(CollabPanel, {
    controller,
    strings: EN,
    renderComposer: (slot) =>
      createElement(CollabComposer, { ...slot, strings: { ...EN, ...COMPOSER_STRINGS } }),
  })
}

async function mountPanel(source: ReturnType<typeof fakeSource>) {
  await act(async () => {
    root.render(createElement(Harness, { source }))
    await flush()
  })
}

const box = () => el.querySelector('textarea')!

async function typeAndSend(text: string) {
  await act(async () => {
    nativeValue.call(box(), text)
    box().dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    box().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    await flush()
  })
}

describe('CollabComposer as the panel composer slot (discussion)', () => {
  it('sends through the controller, then clears the box and the draft', async () => {
    const source = fakeSource(list([]))
    await mountPanel(source)
    expect(box().getAttribute('aria-label')).toBe('Write in the discussion…')
    await typeAndSend('Hello team')
    expect(source.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'discussion', body: 'Hello team' }),
    )
    expect(box().value).toBe('')
    expect(loadDraft({ documentId: 'doc1', threadKey: 'discussion' })).toBeNull()
  })

  it('a failed send keeps the text and the draft and says so', async () => {
    const source = fakeSource(list([]))
    source.create.mockRejectedValueOnce(err('internal'))
    await mountPanel(source)
    await typeAndSend('Do not lose me')
    expect(box().value).toBe('Do not lose me')
    expect(loadDraft({ documentId: 'doc1', threadKey: 'discussion' })).toBe('Do not lose me')
    expect(el.textContent).toContain('Couldn’t send. Your text is still in the box.')
    expect(box().getAttribute('aria-describedby')).toContain(
      [...el.querySelectorAll('.collab-composer-error')][0]!.id,
    )
    // the panel status line (server error) now blocks Send with a pointer to it
    const send = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Send')!
    expect(send.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(send.getAttribute('aria-describedby')!)).not.toBeNull()
  })
})
