import { useState, type ReactNode } from 'react'
import { canPurgeDocuments } from '../uniwork-library-api'
import { DocPurgeConfirm } from './DocPurgeConfirm'

/**
 * UNI-2078: the host hook of Delete forever on one trash row. `available` is whether the row
 * entry is offered: this shell has the call (a stale preload has none). `open(doc)` mounts the
 * confirm, `dialog` is what the host renders.
 */
export interface DocPurgeHandle {
  available: boolean
  open: (doc: { id: string; title: string; kind?: string | null }) => void
  dialog: ReactNode
}

export function useDocPurge({
  onPurged,
  onNotInTrash,
}: {
  onPurged: (title: string) => void
  onNotInTrash: () => void
}): DocPurgeHandle {
  const [target, setTarget] = useState<{ id: string; title: string; kind?: string | null } | null>(
    null,
  )
  const available = canPurgeDocuments()
  return {
    available,
    open: (doc) => {
      if (available) setTarget(doc)
    },
    dialog: target ? (
      <DocPurgeConfirm
        doc={target}
        onPurged={(title) => {
          setTarget(null)
          onPurged(title)
        }}
        onNotInTrash={() => {
          setTarget(null)
          onNotInTrash()
        }}
        onCancel={() => setTarget(null)}
      />
    ) : null,
  }
}
