// RF3D-1: under tracked-changes protection Word forces tracking on, so the AI panel's
// Track changes pill shows as on and cannot be switched off (switching off would accept the AI's
// revisions and let the user bypass the forced tracking). It says why, visibly and to a screen reader.
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { strings } from '../src/renderer/i18n/strings'
import { mountDocsAiPanel, settle, type DocsAiHarness } from './helpers/docs-ai-run-harness'

let h: DocsAiHarness | null = null
afterEach(() => {
  h?.cleanup()
  h = null
  localStorage.clear()
})

const pill = (c: HTMLElement) => c.querySelector('.ai-track-btn') as HTMLButtonElement
const dicts = strings as unknown as Record<string, Record<string, string>>

describe('AI panel Track changes under tracked-changes protection', () => {
  it('shows as on and disabled, with a reason a screen reader reads', async () => {
    localStorage.clear()
    h = await mountDocsAiPanel(['one'], { protection: 'trackedChanges', lang: 'en' })
    const btn = pill(h.container)
    expect(btn.classList.contains('on')).toBe(true)
    expect(btn.disabled).toBe(true)
    const reasonId = btn.getAttribute('aria-describedby')
    expect(reasonId).toBeTruthy()
    const reason = h.container.querySelector(`#${reasonId}`) as HTMLElement
    expect(reason.textContent).toBe(dicts.en!.aiTrackForced)
    // the hover tip sits on the wrapper: a disabled button gets no pointer events
    expect(btn.closest('.ai-track-wrap')?.getAttribute('data-tip')).toBe(dicts.en!.aiTrackForced)
  })

  it('a click does not turn tracking off or accept the AI revisions', async () => {
    localStorage.clear()
    h = await mountDocsAiPanel(['one'], { protection: 'trackedChanges' })
    await act(async () => pill(h!.container).click())
    await settle()
    expect(pill(h.container).classList.contains('on')).toBe(true)
    expect(localStorage.getItem('ai-docs-track-changes')).toBeNull()
  })

  it('stays on when the stored choice was off', async () => {
    localStorage.setItem('ai-docs-track-changes', '0')
    h = await mountDocsAiPanel(['one'], { protection: 'trackedChanges' })
    expect(pill(h.container).classList.contains('on')).toBe(true)
    expect(pill(h.container).disabled).toBe(true)
  })

  it('an unprotected document keeps the free toggle and no reason', async () => {
    localStorage.setItem('ai-docs-track-changes', '0')
    h = await mountDocsAiPanel(['one'], { protection: 'none' })
    const btn = pill(h.container)
    expect(btn.disabled).toBe(false)
    expect(btn.classList.contains('on')).toBe(false)
    expect(btn.getAttribute('aria-describedby')).toBeNull()
    await act(async () => btn.click())
    await settle()
    expect(pill(h.container).classList.contains('on')).toBe(true)
  })
})

describe('forced-tracking reason string', () => {
  it('has no internal codes, is translated everywhere, reads naturally in vi', () => {
    const en = dicts.en!.aiTrackForced
    expect(en).toBeTruthy()
    expect(dicts.vi!.aiTrackForced).toMatch(/theo dõi/i)
    const same = Object.entries(dicts)
      .filter(([lang]) => lang !== 'en')
      .filter(([, d]) => !d.aiTrackForced || d.aiTrackForced === en)
      .map(([lang]) => lang)
    expect(same).toEqual([])
    for (const d of Object.values(dicts)) expect(d.aiTrackForced).not.toMatch(/G\d-\d|UNI-\d|git/i)
  })
})
