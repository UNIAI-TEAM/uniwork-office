import { readAppSettings, writeAppSetting } from '../app-settings'
import type { LocalModelChoice, ModelPickStore } from './keys'

/** app-settings key of the desktop model picks for models served by keys saved on UniWork */
const MODEL_PICKS_SETTING = 'uniworkAiModelPicks'

const picksOf = (value: unknown): Partial<Record<string, LocalModelChoice>> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<Record<string, LocalModelChoice>>)
    : {}

/**
 * The desktop model pick per account + organization (contract §6.1), in app-settings.json beside
 * the remembered organization: never in ai-settings.json, never a key.
 */
export function appSettingsModelPicks(path: () => string): ModelPickStore {
  const readAll = (): Record<string, Partial<Record<string, LocalModelChoice>>> => {
    const raw = readAppSettings(path())[MODEL_PICKS_SETTING]
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, Partial<Record<string, LocalModelChoice>>>)
      : {}
  }
  return {
    read: (scope) => picksOf(readAll()[scope]),
    write: (scope, provider, choice) => {
      const all = readAll()
      // an entry of the wrong shape (a hand-edited file) is replaced, not spread into the new one
      writeAppSetting(path(), MODEL_PICKS_SETTING, {
        ...all,
        [scope]: { ...picksOf(all[scope]), [provider]: choice },
      })
    },
  }
}

/**
 * What the keys host does when the server says the device is revoked: the account's own refresh
 * gets the same answer and runs the shell's signed-out flow (status push, documents, UniWork AI
 * turns). A failing refresh is the account manager's to report, not the keys host's.
 */
export function refreshAfterDeviceRevoked(account: { refresh(): Promise<unknown> }): () => void {
  return () => void account.refresh().catch(() => undefined)
}
