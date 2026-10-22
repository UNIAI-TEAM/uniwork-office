import type { ComponentProps, ReactElement } from 'react'
import { AskUniSteps as SharedSteps } from '@genoffice/ui'
import { ShellAskUniScope } from './shell-adapter'

/** "Looked at 24 tasks, 3 meetings" on Home: the shared summary over the shell adapter. */
export function AskUniSteps(props: ComponentProps<typeof SharedSteps>): ReactElement {
  return (
    <ShellAskUniScope>
      <SharedSteps {...props} />
    </ShellAskUniScope>
  )
}
