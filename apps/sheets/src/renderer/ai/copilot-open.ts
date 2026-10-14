/**
 * Open/close request of the AI dock, resolved against a pending ask_clarification: the card lives
 * in the dock, so while a question waits the dock cannot be closed (a hidden card would leave
 * the run looking hung). Opening, and every request when nothing waits, behave as asked.
 */
export function resolveCopilotOpen(
  prev: boolean,
  next: boolean | ((open: boolean) => boolean),
  asking: boolean,
): boolean {
  const wanted = typeof next === 'function' ? next(prev) : next
  return wanted || asking
}

/**
 * Grid-column class of the app shell. Without the `ai` capability, or with the sidebar switch off
 * and the panel closed (the panel renders nothing then, no rail either), the grid has no dock
 * column at all; otherwise a closed panel leaves its 34px rail column.
 */
export function copilotShellClass(
  hasAi: boolean,
  sidebarEnabled: boolean,
  isOpen: boolean,
): '' | 'no-copilot' | 'copilot-collapsed' {
  if (!hasAi || (!sidebarEnabled && !isOpen)) return 'no-copilot'
  return isOpen ? '' : 'copilot-collapsed'
}
