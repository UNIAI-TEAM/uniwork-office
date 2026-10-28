/**
 * Whether the AI panel is on UniWork AI right now. Read right before the job a web host handed over
 * (`ai.start`, UNI-2264) would run, not when it arrived: only UniWork AI runs that job, so on any
 * other provider (or with no answer) it waits in the composer for the person to send.
 */
export async function aiPanelOnUniwork(
  settings: () => Promise<{ readonly provider?: string } | null | undefined>,
): Promise<boolean> {
  try {
    return (await settings())?.provider === 'uniwork'
  } catch {
    return false
  }
}
