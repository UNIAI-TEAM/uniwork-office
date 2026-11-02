import { cloudToolsEnabled } from '@genoffice/ai-provider'
import type { UniworkToolPolicy } from '@genoffice/ai-provider'
import { readAiSettingsFile } from '@genoffice/ai-search'

/**
 * Cloud tools go out with a turn only while the org has office.ai_cloud AND the user's
 * "Use UniWork cloud tools" switch (gskToolsEnabled in ai-settings.json, absent = on) is on.
 */
export function uniworkToolPolicy(aiSettingsPath: string): UniworkToolPolicy {
  return { cloudTools: cloudToolsEnabled(readAiSettingsFile(aiSettingsPath)) }
}
