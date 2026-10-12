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
