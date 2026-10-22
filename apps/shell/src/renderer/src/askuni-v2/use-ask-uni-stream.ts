import {
  useAskUniStream as useSharedAskUniStream,
  useStreamFocus,
  type AskStreamApi,
  type AskStreamState,
  type AskStreamStatus,
  type AskUniAskInput,
  type AskUniStreamHandle,
  type UseAskUniStreamOptions as SharedOptions,
} from '@genoffice/ui'
import { useShellAskUniAdapter } from './shell-adapter'

export { useStreamFocus }
export type { AskStreamApi, AskStreamState, AskStreamStatus, AskUniAskInput, AskUniStreamHandle }

export interface UseAskUniStreamOptions extends Omit<SharedOptions, 'workspaceId'> {
  /** null = no workspace yet: an ask fails with `error` */
  workspaceId: string | null
}

/**
 * One streamed Ask UNI turn at a time over the shell's session (window.aiOffice); the behaviour
 * lives in @genoffice/ui, shared with the editors.
 */
export function useAskUniStream(options: UseAskUniStreamOptions): AskUniStreamHandle {
  return useSharedAskUniStream(useShellAskUniAdapter(), options)
}
