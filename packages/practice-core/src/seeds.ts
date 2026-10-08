import type { PracticeMeta } from './types.js'

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function facetBlock(meta: PracticeMeta): string {
  const rows = Object.entries(meta.facets)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `<p><strong>${esc(k)}:</strong> ${esc(v)}</p>`)
    .join('')
  return `
    <p><strong>Tiêu đề:</strong> ${esc(meta.title)}</p>
    ${rows}
  `
}

/** Generic HTML seed for non-teacher practice material roles. */
export function practiceMaterialSeedHtml(roleId: string, roleLabel: string, meta: PracticeMeta): string {
  return `
    <h1>${esc(roleLabel)}</h1>
    ${facetBlock(meta)}
    <h2>Nội dung</h2>
    <p></p>
    <h2>Ghi chú</h2>
    <p></p>
    <p><em>Vai trò tài liệu: ${esc(roleId)}</em></p>
  `.trim()
}

export function practiceSkillPrompt(
  skillLabel: string,
  skillDesc: string,
  meta: PracticeMeta,
): string {
  const ctx = [
    `Tiêu đề: ${meta.title}`,
    ...Object.entries(meta.facets).map(([k, v]) => `${k}: ${v}`),
    meta.tags?.length ? `Thẻ: ${meta.tags.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return [
    'Bạn là trợ lý chuyên môn trên UniOffice (soạn thảo tại máy, CT / quy định Việt Nam khi phù hợp).',
    'Không bịa số liệu pháp lý hoặc kỹ thuật; nêu rõ giả định.',
    '',
    `Nhiệm vụ: ${skillLabel}`,
    skillDesc,
    '',
    'Ngữ cảnh gói:',
    ctx,
    '',
    'Viết nội dung sẵn đưa vào tài liệu đang mở, cấu trúc rõ ràng, tiếng Việt.',
  ].join('\n')
}
