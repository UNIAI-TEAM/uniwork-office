import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'

/**
 * UNI-2052: the Open dialog opens over the Documents home and both mount the
 * upload layer, but the runs are one set (the module store): only one layer
 * draws the bars. The first layer mounted owns them; when it unmounts the next
 * one takes over.
 */

const owners: symbol[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** True while this layer is the one that shows the bars */
export function useOwnsFolderUploadBars(): boolean {
  const token = useRef<symbol>(null as unknown as symbol)
  if (token.current === null) token.current = Symbol('folder-upload-layer')
  const self = token.current
  useLayoutEffect(() => {
    owners.push(self)
    emit()
    return () => {
      owners.splice(owners.indexOf(self), 1)
      emit()
    }
  }, [self])
  return useSyncExternalStore(subscribe, () => owners[0] === self)
}
