import type { ComponentProps, ReactElement } from 'react'
import { AskUniActions as SharedActions, answerPlainText, clearAskUniRatings } from '@genoffice/ui'
import { ShellAskUniScope } from './shell-adapter'

export { answerPlainText, clearAskUniRatings }

/** Copy, regenerate and rating under an answer on Home: the shared bar over the shell adapter. */
export function AskUniActions(props: ComponentProps<typeof SharedActions>): ReactElement {
  return (
    <ShellAskUniScope>
      <SharedActions {...props} />
    </ShellAskUniScope>
  )
}
