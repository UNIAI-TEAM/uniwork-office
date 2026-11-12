import { t } from './i18n/locale'

let current = ''
const listeners = new Set<() => void>()

/** Settings → General user name; the generic label until the shell has answered */
export function authorName(): string {
  return current || t('editorDefaultAuthor')
}

export function setAuthorName(name?: string | null): void {
  const next = typeof name === 'string' ? name.trim() : ''
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

export function onAuthorNameChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
