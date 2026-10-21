import { useEffect, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import { dragHasFiles, readDropped, type DroppedItem } from './drop'

/** The preload's `getPathForFile` (the one Electron webUtils helper the renderer may use) */
export function pathOfDroppedFile(file: File): string {
  const api = window.aiOffice as { getPathForFile?: (file: File) => string } | undefined
  try {
    return api?.getPathForFile?.(file) ?? ''
  } catch {
    return ''
  }
}

/**
 * UNI-2052: the UniWork library list as a drop zone. While `enabled` is false
 * (a viewer, or a screen that is not a folder) the zone does nothing and the
 * window-level drop-to-open keeps working; while it is true the drop is
 * cancelled here so that bridge stays out of the way (its ownership contract).
 */
export interface DropZoneBox {
  top: number
  left: number
  width: number
  height: number
}

export function useLibraryDrop({
  enabled,
  onDrop,
}: {
  enabled: boolean
  onDrop: (items: DroppedItem[]) => void
}) {
  // the zone's box while a drag hovers it: the overlay is fixed to it, so scrolling the list never moves it away
  const [over, setOver] = useState<DropZoneBox | null>(null)
  // dragenter / dragleave also fire for every child: only the depth reaching zero ends the hover
  const depth = useRef(0)
  const take = (event: ReactDragEvent) => enabled && dragHasFiles(event.dataTransfer)
  const hovering = over !== null

  // leaving the window mid-drag can eat the dragleave (Home's own overlay knows it too):
  // while the hover shows, a window drop / dragend / blur ends it
  useEffect(() => {
    if (!hovering) return
    const reset = () => {
      depth.current = 0
      setOver(null)
    }
    const events = ['drop', 'dragend', 'blur'] as const
    for (const name of events) window.addEventListener(name, reset)
    return () => {
      for (const name of events) window.removeEventListener(name, reset)
    }
  }, [hovering])
  return {
    over: enabled ? over : null,
    handlers: {
      onDragEnter: (event: ReactDragEvent) => {
        if (!take(event)) return
        depth.current += 1
        const box = event.currentTarget.getBoundingClientRect()
        setOver({ top: box.top, left: box.left, width: box.width, height: box.height })
      },
      onDragOver: (event: ReactDragEvent) => {
        if (!take(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      },
      onDragLeave: (event: ReactDragEvent) => {
        if (!take(event)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(null)
      },
      onDrop: (event: ReactDragEvent) => {
        if (!take(event)) return
        event.preventDefault()
        depth.current = 0
        setOver(null)
        onDrop(readDropped(event.dataTransfer, pathOfDroppedFile))
      },
    },
  }
}
