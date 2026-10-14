import { escapeHtml, profileForDraft, profileMergeHtml } from './form-merge'
import type { WbFormItem } from './workbench-pins'

/** "Soạn" from a saved form: a new Docs file in `packId`, the UniWork profile fields merged in. */
export async function draftFromForm(
  item: WbFormItem,
  packId: string,
  orgId: string | null,
  vi: boolean,
): Promise<void> {
  // merge fields from the UniWork profile: cached first, never blocking compose (form-merge.ts)
  const metaLines = profileMergeHtml(await profileForDraft(orgId))
  const fileHint = item.fileName
    ? `<p><em>${vi ? 'Mẫu gốc' : 'Source template'}: ${escapeHtml(item.fileName)}</em></p>`
    : ''
  const html = `
      <h1>${escapeHtml(item.title)}</h1>
      ${item.note ? `<p><em>${escapeHtml(item.note)}</em></p>` : ''}
      ${fileHint}
      ${metaLines}
      <h2>${vi ? 'Nội dung' : 'Content'}</h2>
      <p></p>
    `.trim()
  await window.aiOffice.newDoc({ projectId: packId, aiContent: { title: item.title, html } })
}
