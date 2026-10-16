// The window's live nodes keep announcing while a frame dialog (S5) is open: the dialog inerts the
// rest of the frame, and an `inert` ancestor silences a live region, so the pair stays outside it.
import { afterEach, describe, expect, it } from 'vitest'
import { frameAsk } from './frame-dialog'
import { createRemoteBar } from './remote-bar'

afterEach(() => {
  document.body.replaceChildren()
})

const conflict = () =>
  frameAsk({
    title: 'Changed elsewhere',
    body: 'Someone saved a newer version.',
    choices: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'reload', label: 'Reload latest' },
    ],
    cancelId: 'cancel',
    marker: 'conflict',
  })

describe('live nodes while a frame dialog is open (UXF-04)', () => {
  it('stay outside the inert tree, and the rest of the frame is still inert', async () => {
    document.body.innerHTML = '<div id="root"><button id="app">App</button></div>'
    createRemoteBar().show({ tone: 'info', region: 'remote', text: 'A newer version.' })
    const done = conflict()
    const live = [...document.querySelectorAll('.uw-live')].map((el) => ({
      role: el.getAttribute('role'),
      inert: el.closest('[inert]') !== null,
    }))
    expect(live.map((l) => l.role).sort()).toEqual(['alert', 'status'])
    expect(live.filter((l) => l.inert)).toEqual([])
    expect(document.getElementById('root')!.hasAttribute('inert')).toBe(true)
    document.querySelector<HTMLButtonElement>('[data-choice="cancel"]')!.click()
    await done
    expect(document.getElementById('root')!.hasAttribute('inert')).toBe(false)
  })
})
