import { authorName } from '../author-name'
import { t } from '../i18n/locale'

/** default author on AI-generated tracked revisions when Settings has no user name */
export const AI_REVISION_AUTHOR = 'AI Assistant'

/** AI edits are attributed to the Settings user name when set, else AI_REVISION_AUTHOR */
export function aiRevisionAuthor(): string {
  const name = authorName()
  return name && name !== t('editorDefaultAuthor') ? name : AI_REVISION_AUTHOR
}
