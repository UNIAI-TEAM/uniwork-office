import type { UniworkSourceFile } from '../../../shared/home-api'

/** compile stub of UNI-1993 C2 (red commit): replaced by the real helper in the feat commit */
export function openable(_source: Pick<UniworkSourceFile, 'canOpenInApp'>): boolean {
  return false
}

export function sourceOpenExtension(_source: Pick<UniworkSourceFile, 'extension'>): string | null {
  return null
}
