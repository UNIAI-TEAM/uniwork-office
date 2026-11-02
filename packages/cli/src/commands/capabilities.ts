import type { CommandDef } from '../registry'
import { appLaunch } from '../resources'

/**
 * Whether the UniWork Office app is installed (the one thing the CLI cannot do
 * without it is open a document in the GUI). Everything else the CLI does runs
 * locally; it has no cloud features. Agents check this once before planning
 * work that needs the app open.
 */
export const capabilitiesCommand: CommandDef = {
  name: 'capabilities',
  summary: 'Report whether the UniWork Office app is installed.',
  usage: 'capabilities',
  async run(_args, ctx) {
    const available = appLaunch(ctx.env) !== null
    return {
      summary: available ? 'the app is installed' : 'the app is not installed',
      detail: { app: { available } },
    }
  },
}
