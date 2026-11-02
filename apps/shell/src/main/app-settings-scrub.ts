import { readAppSettings, replaceAppSettings } from './app-settings'

/**
 * The decision-model file search kept its provider keys under `fileSearch` in app-settings.json.
 * That feature is gone; drop the key (and every other setting stays) so no key outlives it.
 * Rewrites the file only when the key is there.
 */
export function scrubFileSearchSetting(appSettingsPath: string): void {
  const settings = readAppSettings(appSettingsPath)
  if (!('fileSearch' in settings)) return
  const { fileSearch: _dropped, ...rest } = settings
  replaceAppSettings(appSettingsPath, rest)
}
