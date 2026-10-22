import { useState, type ReactNode } from 'react'
import { canCopyDocuments } from '../uniwork-library-api'
import { DocCopyDialog } from './DocCopyDialog'

/**
 * UNI-2078: the host hook of Make a copy. `available` is whether the row entry is offered: this
 * shell has the call and the deployment has not answered "no copy route" (404 / 501) yet - that
 * answer hides the entry for the rest of the session, across remounts of the Documents screen.
 * `open(doc)` mounts the dialog, `dialog` is what the host renders.
 */
let routeMissing = false

/** tests only: a new session */
export function resetDocCopyAvailability(): void {
  routeMissing = false
}

export interface DocCopyHandle {
  available: boolean
  open: (doc: { id: string; title: string }) => void
  dialog: ReactNode
}

export function useDocCopy({ onCopied }: { onCopied: (title: string) => void }): DocCopyHandle {
  const [target, setTarget] = useState<{ id: string; title: string } | null>(null)
  const [missing, setMissing] = useState(routeMissing)
  const available = canCopyDocuments() && !missing && !routeMissing
  return {
    available,
    open: (doc) => {
      if (available) setTarget(doc)
    },
    dialog: target ? (
      <DocCopyDialog
        doc={target}
        onCopied={(title) => {
          setTarget(null)
          onCopied(title)
        }}
        onUnavailable={() => {
          routeMissing = true
          setMissing(true)
        }}
        onCancel={() => setTarget(null)}
      />
    ) : null,
  }
}
