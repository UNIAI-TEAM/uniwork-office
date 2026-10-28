import type { zh } from './zh'

export const hi = {} satisfies Record<keyof typeof zh, string>
