/**
 * Whether a preset the AI panel received from outside (`consumeAiPreset` / `onAiPreset`) sends at
 * once. On the desktop it is the shell's preset and runs as asked. In a web frame it is the job the
 * host handed over (`ai.start`, UNI-2264): that job runs only on UniWork AI, so on any other
 * provider it waits in the composer for the person to send (or to switch to UniWork AI first).
 */
export async function aiPresetAutoRuns(
  preset: { readonly autoRun?: boolean | undefined },
  web: boolean,
  settings: () => Promise<{ readonly provider?: string } | null | undefined>,
): Promise<boolean> {
  if (preset.autoRun === false) return false
  if (!web) return true
  const current = await settings().catch(() => null)
  return current?.provider === 'uniwork'
}
