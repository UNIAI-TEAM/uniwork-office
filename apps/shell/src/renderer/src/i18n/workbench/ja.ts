import type { zh } from './zh'
import { en } from './en'

// shortcut: English copy until this locale is translated (spec 6.8); replace the spread with real strings then
export const ja = { ...en } satisfies Record<keyof typeof zh, string>
