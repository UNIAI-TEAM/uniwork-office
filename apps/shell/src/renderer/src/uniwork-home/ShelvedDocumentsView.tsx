import { useI18n } from '../locale'
import {
  DOCUMENTS_HOME_FORMAT_OPTIONS,
  shelvedByOptionsOf,
  shelverKeyOf,
  type DocumentsHomeDoc,
  type DocumentsHomeTypeFilter,
} from './documents-home-model'

/**
 * UNI-1961 (ARCHIVE-01): the Lưu trữ / Archive shelf of the Documents home,
 * drawn as the web's DocumentsShelvedView (D packages/views/documents
 * documents-shelved-view/-toolbar/-row.tsx): the intro, the type filter, the
 * "Lưu trữ bởi" filter over the loaded rows (the server has no `shelved_by`
 * parameter, so the toolbar says so). The rows are drawn by the shared
 * Documents table (doclist/DocList, screen `shelved`), newest shelved first;
 * shelved folders are rows too and never browse.
 */

const SHELVED_BY_ANY = ''

/** the rows the "Lưu trữ bởi" filter keeps (null = anyone) */
export function filterByShelver(
  docs: readonly DocumentsHomeDoc[],
  shelvedBy: string | null,
): DocumentsHomeDoc[] {
  if (shelvedBy === null) return [...docs]
  return docs.filter((doc) => shelverKeyOf(doc) === shelvedBy)
}

/** the ids of `root`'s descendants that are rows of the loaded shelf (a folder unshelve may leave them) */
export function shelvedDescendantIds(
  root: DocumentsHomeDoc,
  docs: readonly DocumentsHomeDoc[],
): Set<string> {
  const byParent = new Map<string, DocumentsHomeDoc[]>()
  for (const doc of docs) {
    if (!doc.parentId) continue
    const siblings = byParent.get(doc.parentId) ?? []
    siblings.push(doc)
    byParent.set(doc.parentId, siblings)
  }
  const out = new Set<string>()
  const queue = [...(byParent.get(root.id) ?? [])]
  while (queue.length > 0) {
    const next = queue.shift()!
    if (out.has(next.id)) continue
    out.add(next.id)
    queue.push(...(byParent.get(next.id) ?? []))
  }
  return out
}

export function ShelvedToolbar({
  items,
  format,
  onFormat,
  shelvedBy,
  onShelvedBy,
}: {
  items: readonly DocumentsHomeDoc[]
  format: DocumentsHomeTypeFilter
  onFormat: (format: DocumentsHomeTypeFilter) => void
  shelvedBy: string | null
  onShelvedBy: (value: string | null) => void
}) {
  const { t } = useI18n()
  const options = shelvedByOptionsOf(items, t)
  // keep a picked shelver selectable after a reload dropped its rows
  const known = shelvedBy === null || options.some((opt) => opt.id === shelvedBy)
  return (
    <div className="dh-shelved-head">
      <p className="dh-shelved-intro">{t('uhShelvedIntro')}</p>
      <div className="dh-shelved-toolbar">
        <label className="dh-filter-chip">
          <span className="dh-filter-k">{t('uhFilterType')}</span>
          <select
            className="dh-filter-select"
            data-filter="format"
            aria-label={t('uhFilterType')}
            value={format}
            onChange={(e) => onFormat(e.target.value as DocumentsHomeTypeFilter)}
          >
            {DOCUMENTS_HOME_FORMAT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.labelKey ? t(opt.labelKey) : opt.literal}
              </option>
            ))}
          </select>
        </label>
        <div className="dh-shelved-by">
          <label className="dh-filter-chip">
            <span className="dh-filter-k">{t('uhShelvedFilterBy')}</span>
            <select
              className="dh-filter-select"
              data-filter="shelvedBy"
              aria-label={t('uhShelvedFilterBy')}
              value={shelvedBy ?? SHELVED_BY_ANY}
              onChange={(e) =>
                onShelvedBy(e.target.value === SHELVED_BY_ANY ? null : e.target.value)
              }
            >
              <option value={SHELVED_BY_ANY}>{t('uhShelvedFilterAny')}</option>
              {options.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
              {!known && <option value={shelvedBy!}>{t('uwEditLockSomeone')}</option>}
            </select>
          </label>
          {shelvedBy !== null && (
            <span className="dh-shelved-loaded-only">{t('uhShelvedLoadedOnly')}</span>
          )}
        </div>
      </div>
    </div>
  )
}
