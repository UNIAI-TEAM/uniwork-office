import type { ComponentProps, ReactElement } from 'react'
import { AskUniTurn as SharedTurn, type AskUniTurnMessage } from '@genoffice/ui'
import { ShellAskUniScope } from './shell-adapter'

export type { AskUniTurnMessage }

/** One question or answer on Home: the shared turn over the shell adapter. */
export function AskUniTurn(props: ComponentProps<typeof SharedTurn>): ReactElement {
  return (
    <ShellAskUniScope>
      <SharedTurn {...props} />
    </ShellAskUniScope>
  )
}
