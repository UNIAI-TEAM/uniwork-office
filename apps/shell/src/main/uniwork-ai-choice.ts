/**
 * "UniWork AI is my provider" per UniWork account (G6-05 Q-3, desktop). The choice is one key in
 * the account store (workbench-accounts: one database per account, the signed-out bucket for no
 * account), so switching account brings back that account's choice. BYOK settings stay in
 * ai-settings.json (docs-main): the file never holds provider `uniwork`.
 */
import type { UniworkAiChoiceStore } from '../../../docs/src/main/docs-main'
import type { WorkbenchAccounts } from './workbench-accounts'

export const UNIWORK_AI_CHOICE_KEY = 'uniwork.ai.uniwork-choice'

export function createUniworkAiChoiceStore(
  accounts: Pick<WorkbenchAccounts, 'activeDb'>,
): UniworkAiChoiceStore {
  return {
    read: () => {
      try {
        return accounts.activeDb()?.get(UNIWORK_AI_CHOICE_KEY) === '1'
      } catch {
        return false
      }
    },
    write: (on) => {
      try {
        const db = accounts.activeDb()
        if (on) db?.set(UNIWORK_AI_CHOICE_KEY, '1')
        else db?.remove(UNIWORK_AI_CHOICE_KEY)
      } catch {
        /* a store that cannot write leaves the choice as it was */
      }
    },
  }
}
