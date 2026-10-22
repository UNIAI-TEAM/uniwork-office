/** Distance (px) from the window bottom to the toast: 8px over the 24px status bar, or 8px over
 * the notes pane while it is shown (it sits directly above the status bar and is user-resizable). */
export function toastBottomPx(showNotes: boolean, notesHeight: number): number {
  return 32 + (showNotes ? Math.max(0, notesHeight) : 0)
}
