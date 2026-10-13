import type { zh } from './zh'

export const zhTW = {
  serverCommentStartUnavailable: '暫時無法向此文件新增評論。',
  serverCommentSaveFirst: '請先儲存文件，再新增註解',
} satisfies Record<keyof typeof zh, string>
