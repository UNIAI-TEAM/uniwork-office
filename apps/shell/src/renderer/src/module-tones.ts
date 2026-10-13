import type { PracticePillarId, WorkbenchModuleId } from '@uniwork/practice-core'

/** UniWork tint hues; each is a --tint-<hue> fill + --tint-<hue>-fg glyph pair in tokens.css */
export type Tint = 'gray' | 'green' | 'yellow' | 'orange' | 'violet' | 'blue' | 'teal' | 'pink'

/** module identity color (spec 6.1); the 4 pillars are "Tri thức" and share blue */
export const MODULE_TONES: Record<WorkbenchModuleId | PracticePillarId, Tint> = {
  desk: 'gray',
  tasks: 'green',
  calendar: 'yellow',
  personal: 'pink',
  forms: 'teal',
  notes: 'gray',
  knowledge: 'blue',
  materials: 'blue',
  skills: 'blue',
  compose: 'blue',
}

/** calendar agenda: task rows use MODULE_TONES.tasks, meetings keep violet (as on UniWork web) */
export const MEETING_TINT: Tint = 'violet'

export const tintStyle = (t: Tint) => ({
  background: `var(--tint-${t})`,
  color: `var(--tint-${t}-fg)`,
})

/** status hues for error / offline / sign-in tiles; the glyph is the AA text token of each pair */
export type SignalTone = 'danger' | 'warning' | 'info'

export const signalStyle = (s: SignalTone) => ({
  background: `var(--${s}-bg)`,
  color: s === 'info' ? 'var(--info)' : `var(--${s}-text)`,
})
