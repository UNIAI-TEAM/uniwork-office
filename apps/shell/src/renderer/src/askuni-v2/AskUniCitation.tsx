import type { ComponentProps, ReactElement } from 'react'
import {
  CitationMarker as SharedMarker,
  KindIcon,
  SourceChips as SharedChips,
  knownKind,
} from '@genoffice/ui'
import { ShellAskUniScope } from './shell-adapter'

export { KindIcon, knownKind }

export function CitationMarker(props: ComponentProps<typeof SharedMarker>): ReactElement {
  return (
    <ShellAskUniScope>
      <SharedMarker {...props} />
    </ShellAskUniScope>
  )
}

export function SourceChips(props: ComponentProps<typeof SharedChips>): ReactElement | null {
  return (
    <ShellAskUniScope>
      <SharedChips {...props} />
    </ShellAskUniScope>
  )
}
