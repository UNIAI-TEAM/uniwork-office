// Test helper for the AI panels: acknowledge the UniWork AI disclosure of one document, the way a
// person does once before the first send. A panel under test has no cloud account (signed out), so
// this is the in-memory ack an empty account gets: it is never stored, and clearUniworkAcks()
// drops it. `path` is the panel's document path ('local' for an untitled document).
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { clearUniworkAcks, useUniworkDisclosureAck } from '@genoffice/ui'

export function ackUniworkDisclosureInFile(path: string | null = 'local'): void {
  function Ack(): null {
    const { acknowledge } = useUniworkDisclosureAck({
      account: '',
      org: '',
      document: path ?? 'local',
    })
    useEffect(() => acknowledge(), [acknowledge])
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Ack)))
  act(() => root.unmount())
}

/**
 * UniWork AI on, the way a signed-in host with the capability reports it, and its disclosure
 * acknowledged for each document (`'local'` when none is named). resetUniworkAi() undoes both.
 */
export function readyUniworkAi(...paths: (string | null)[]): void {
  setUniworkAiAvailable(true)
  for (const path of paths.length > 0 ? paths : ['local']) ackUniworkDisclosureInFile(path)
}

export function resetUniworkAi(): void {
  clearUniworkAcks()
  setUniworkAiAvailable(false)
}
