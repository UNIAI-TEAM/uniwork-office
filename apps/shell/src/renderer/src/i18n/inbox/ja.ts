import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy until the locale sweep translates the inbox (spec 6.8)
export const ja = {
  ...en,
} satisfies Record<keyof typeof zh, string>
