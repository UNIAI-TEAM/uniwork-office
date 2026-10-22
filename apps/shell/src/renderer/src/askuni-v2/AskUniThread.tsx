import type { ReactElement } from 'react'
import { AskUniThread as SharedThread, type AskUniThreadProps as SharedProps } from '@genoffice/ui'
import type { AskUniStreamHandle } from './use-ask-uni-stream'
import { ShellAskUniScope } from './shell-adapter'

export type { AskUniStreamHandle }

export interface AskUniThreadProps extends Omit<SharedProps, 'workspaceId' | 'loadMessages'> {
  workspaceId: string
  /** the stored messages of a conversation of this workspace; a failed load keeps what is shown */
  loadMessages: NonNullable<SharedProps['loadMessages']>
}

/** The scrollable message area of Ask UNI on Home: the shared thread over the shell adapter. */
export function AskUniThread(props: AskUniThreadProps): ReactElement {
  return (
    <ShellAskUniScope>
      <SharedThread {...props} />
    </ShellAskUniScope>
  )
}
