import type { EduMeta } from './types.js'

/** Plain-text README bundled into a lesson-pack zip for teachers. */
export function eduPackReadme(meta: EduMeta, fileNames: string[]): string {
  const lines = [
    'Gói bài UniWork Office — Giáo viên',
    '================================',
    '',
    `Môn: ${meta.subject}`,
    `Lớp: ${meta.grade}`,
    meta.week ? `Tuần: ${meta.week}` : null,
    `Bài: ${meta.lessonTitle}`,
    typeof meta.durationMinutes === 'number' ? `Thời lượng: ${meta.durationMinutes} phút` : null,
    '',
    'Mục tiêu / chuẩn đầu ra:',
    ...(meta.objectives.length > 0
      ? meta.objectives.map((o, i) => `  ${i + 1}. ${o}`)
      : ['  (chưa khai báo)']),
    '',
    'Tệp trong gói:',
    ...fileNames.map((n) => `  - ${n}`),
    '',
    'Ghi chú:',
    '- Soạn thảo và xuất file trên máy không bị trừ Token AI.',
    '- Chỉ khi bật workflow / chat AI mới trừ Token trên Hub.',
    `- Xuất lúc: ${new Date().toISOString()}`,
    '',
  ]
  return lines.filter((l) => l !== null).join('\n')
}

/** Heuristic for Hub / gateway “out of credits” messages (any language). */
export function looksLikeAiCreditError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('credit') ||
    m.includes('quota') ||
    m.includes('billing') ||
    m.includes('insufficient') ||
    m.includes('balance') ||
    m.includes('payment required') ||
    m.includes('hết token') ||
    m.includes('het token') ||
    m.includes('hết credit') ||
    m.includes('không đủ') ||
    /\b402\b/.test(m)
  )
}
