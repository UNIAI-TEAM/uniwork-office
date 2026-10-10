/** IPC gradient fill → engine fill spec helpers (shared by slide and master fill edits). */
import type { GradientFillSpec } from '../shared/ipc'

/** IPC gradient → engine stop list (full stop list wins over the two-color from/to form). */
export const gradientStops = (
  g: GradientFillSpec['gradient'],
): Array<{ pos: number; color: string }> =>
  g.stops?.length
    ? g.stops
    : [
        { pos: 0, color: g.from },
        { pos: 1, color: g.to },
      ]

/** IPC gradient → path kind (radial is a legacy alias for circle; undefined = linear). */
export const gradientPathKind = (
  g: GradientFillSpec['gradient'],
): 'circle' | 'rect' | 'shape' | undefined => g.path ?? (g.radial ? 'circle' : undefined)

/** IPC gradient focus point → <a:fillToRect> insets (undefined when unspecified). */
export const gradientFillTo = (
  g: GradientFillSpec['gradient'],
): { l: number; t: number; r: number; b: number } | undefined =>
  g.center ? { l: g.center.x, t: g.center.y, r: 1 - g.center.x, b: 1 - g.center.y } : undefined
