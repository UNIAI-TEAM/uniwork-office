import type { zh } from './zh'

export const ru = {
  serverCommentStartUnavailable: 'Сейчас нельзя добавить новый комментарий к этому документу.',
  serverCommentSaveFirst: 'Сначала сохраните документ, чтобы добавить комментарий',
} satisfies Record<keyof typeof zh, string>
