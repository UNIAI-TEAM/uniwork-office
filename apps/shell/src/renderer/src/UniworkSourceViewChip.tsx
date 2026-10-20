// Stub for the red commit: the real chip lands with the implementation commit.
export type SourceViewOrigin = 'chat' | 'task' | 'meeting' | 'email'

export interface UniworkSourceViewState {
  name: string
  origin: SourceViewOrigin
  parentTitle?: string | null
}

export function UniworkSourceViewChip(_props: { state: UniworkSourceViewState | null }) {
  return null
}
