import { useState } from 'react'
import {
  CITATION_STYLES,
  citationText,
<<<<<<< ours
  generateCaptionXml,
  generateIndexFieldXml,
  type Block,
  type SourceInfo,
} from '@genoffice/docx-engine'
import { Dropdown } from '@genoffice/ui'
import { AppOnlyNote } from './AppOnlyNote'
import { PromptModal } from './PromptModal'
import { cap } from '../capabilities'
import { shortcutAria } from '../shortcuts'
import {
  collectTocEntriesWithPages,
  tocFieldNodes,
  updateTocField,
  xmlOfNode,
} from '../editor/toc-update'
import { useI18n, type StringKey } from '../i18n/locale'
=======
  type CitationStyleId,
  type SourceInfo,
} from '@genoffice/docx-engine'
import { Dropdown } from '@genoffice/ui'
import { useI18n, type StringKey } from '../i18n/locale'
import type { ActionCommandId } from '../../shared/commands'
import { RbCommand, useRunCommand } from './ribbon-command'
>>>>>>> theirs
import {
  IconBook,
  IconCaption,
  IconCaret,
  IconCitation,
  IconEndnote,
  IconFootnote,
  IconIndex,
  IconRefresh,
  IconToc,
  IconAddText,
  IconNextFootnote,
  IconShowNotes,
  IconCitationsPane,
  IconMarkCitation,
  IconToa,
} from './icons'

/** icon size for the big icon-over-label ribbon buttons (slides ribbon parity) */
import { BIG, TabProps, toggleDropdown } from './ribbon-tabs'

<<<<<<< ours
const CAPTION_LABEL_KEYS = [
  'ribbonCaptionFigure',
  'ribbonCaptionTable',
  'ribbonCaptionEquation',
] as const

/** Caption labels are i18n strings interpolated into the SEQ matcher below.
 * A label containing `(`, `+`, `.` or `$` (locale-dependent) would either
 * throw from `new RegExp` - crashing the dialog, whose placeholder calls
 * `nextNumber` on every render - or silently miscount fields. Escape the
 * metacharacters (same set as the find bar's escapeRe) so labels count
 * literally. */
export const escapeReLiteral = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Caption dialog: label + optional description, numbered by existing SEQ fields */
function CaptionModal({
  editor,
  blocks,
  onClose,
}: {
  editor: Editor
  blocks: Block[]
  onClose: () => void
}) {
  const { t } = useI18n()
  const CAPTION_LABELS = CAPTION_LABEL_KEYS.map((k) => t(k))
  const [label, setLabel] = useState<string>(() => t(CAPTION_LABEL_KEYS[0]))
  const [text, setText] = useState('')

  const nextNumber = (lbl: string): number => {
    let count = 0
    const re = new RegExp(`SEQ\\s+${escapeReLiteral(lbl)}[\\s\\\\]`)
    editor.state.doc.forEach((node) => {
      if (node.type.name !== 'docProtected') return
      if (re.test(xmlOfNode(node as never, blocks))) count += 1
    })
    return count + 1
  }

  const insert = () => {
    const number = nextNumber(label)
    const xml = generateCaptionXml(label, number, text.trim())
    const display = `${label} ${number}${text.trim() ? ` ${text.trim()}` : ''}`
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'docProtected',
        attrs: {
          docxIndex: null,
          blockType: 'passthrough',
          label: t('ribbonCaption'),
          genXml: xml,
          fieldDisplay: { kind: 'text', left: display },
        },
      } as never)
      .run()
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{t('ribbonCaptionInsertTitle')}</h2>
        <label>
          {t('ribbonCaptionLabel')}
          <Dropdown
            value={label}
            ariaLabel={t('ribbonCaptionLabel')}
            options={CAPTION_LABELS.map((l) => ({ value: l, label: l }))}
            onPick={setLabel}
          />
        </label>
        <label>
          {t('ribbonCaption')}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('ribbonCaptionPh', { label, n: nextNumber(label) })}
            onKeyDown={(e) => e.key === 'Enter' && insert()}
          />
        </label>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>
            {t('ribbonCancel')}
          </button>
          <button className="btn-primary" onClick={insert}>
            {t('ribbonInsert')}
          </button>
        </div>
      </div>
    </div>
  )
}

=======
>>>>>>> theirs
const SOURCE_TYPES: Array<{ key: string; nameKey: StringKey }> = [
  { key: 'Book', nameKey: 'ribbonSourceBook' },
  { key: 'JournalArticle', nameKey: 'ribbonSourceJournal' },
  { key: 'InternetSite', nameKey: 'ribbonSourceWebsite' },
  { key: 'Report', nameKey: 'ribbonSourceReport' },
  { key: 'Misc', nameKey: 'ribbonSourceMisc' },
]

/** Create Source dialog for the citation manager */
function SourceModal({
  sources,
  onAdd,
  onClose,
}: {
  sources: SourceInfo[]
  onAdd: (source: SourceInfo) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [type, setType] = useState('Book')
  const [author, setAuthor] = useState('')
  const [title, setTitle] = useState('')
  const [year, setYear] = useState('')
  const [publisher, setPublisher] = useState('')
  const [url, setUrl] = useState('')

  const add = () => {
    if (!title.trim()) return
    // unique tag derived from author/title initials + year
    const base = (author.trim() || title.trim()).replace(/[\s,，、]+/g, '').slice(0, 8) || 'Src'
    let tag = `${base}${year.trim()}`
    let n = 1
    while (sources.some((s) => s.tag === tag)) tag = `${base}${year.trim()}_${++n}`
    onAdd({
      tag,
      type,
      author: author.trim(),
      title: title.trim(),
      year: year.trim(),
      ...(publisher.trim() ? { publisher: publisher.trim() } : {}),
      ...(url.trim() ? { url: url.trim() } : {}),
    })
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{t('ribbonSourceCreateTitle')}</h2>
        <label>
          {t('ribbonSourceType')}
          <Dropdown
            value={type}
            ariaLabel={t('ribbonSourceType')}
            options={SOURCE_TYPES.map((s) => ({ value: s.key, label: t(s.nameKey) }))}
            onPick={setType}
          />
        </label>
        <label>
          {t('ribbonSourceAuthor')}
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder={t('ribbonSourceAuthorPh')}
          />
        </label>
        <label>
          {t('ribbonSourceTitle')}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('ribbonSourceTitlePh')}
          />
        </label>
        <label>
          {t('ribbonSourceYear')}
          <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="2026" />
        </label>
        <label>
          {type === 'JournalArticle'
            ? t('ribbonSourceJournalName')
            : type === 'InternetSite'
              ? t('ribbonSourceSiteName')
              : t('ribbonSourcePublisher')}
          <input value={publisher} onChange={(e) => setPublisher(e.target.value)} />
        </label>
        {type === 'InternetSite' && (
          <label>
            URL
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </label>
        )}
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>
            {t('ribbonCancel')}
          </button>
          <button className="btn-primary" disabled={!title.trim()} onClick={add}>
            {t('ribbonAdd')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ReferencesTabProps extends TabProps {
  sources: SourceInfo[]
  citationStyle: CitationStyleId | null
  onAddSource: (source: SourceInfo) => void
}

export function ReferencesTab({
  hasDoc,
  dropdown,
  setDropdown,
  sources,
  citationStyle,
  onAddSource,
}: ReferencesTabProps) {
  const { t } = useI18n()
  const [sourceOpen, setSourceOpen] = useState(false)
  const runCommand = useRunCommand()
  /** a pick from a menu: run the command, close the menu */
  const pick = (id: ActionCommandId, payload?: string) => {
    runCommand(id, payload)
    setDropdown(() => null)
  }

  return (
    <>
<<<<<<< ours
      {!cap('zotero') && (
        <>
          {/* the web build has no Zotero connector: the group stays and explains */}
          <div className="ribbon-group">
            <div className="ribbon-group-items">
              <div className="rb-split-wrap">
                <button
                  className="rb-big"
                  data-tip={t('appOnlyHint')}
                  onClick={() => toggleDropdown(setDropdown, 'zotero-app-only')}
                >
                  <span className="rb-big-icon">
                    <IconCitation size={BIG} />
                    <IconCaret />
                  </span>
                  <span>{t('zoteroGroup')}</span>
                </button>
                {dropdown === 'zotero-app-only' && (
                  <div data-rb-panel="" className="layout-menu">
                    <AppOnlyNote
                      testId="docs-zotero-app-only"
                      lead="appOnlyZotero"
                      feature="docs.zotero"
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="ribbon-group-label">{t('zoteroGroup')}</div>
          </div>

          <div className="ribbon-sep" />
        </>
      )}
      {cap('zotero') && (
        <>
          <div className="ribbon-group">
            <div className="ribbon-group-items">
              <button
                className="rb-big"
                disabled={!hasDoc || zoteroBusy !== null}
                data-tip={t('zoteroCitationTip')}
                onClick={() => void runZotero('addEditCitation')}
              >
                <span className="rb-big-icon">
                  <IconCitation size={BIG} />
                </span>
                <span>{t('zoteroCitation')}</span>
              </button>
              <button
                className="rb-big"
                disabled={!hasDoc || zoteroBusy !== null}
                data-tip={t('zoteroBibliographyTip')}
                onClick={() => void runZotero('addEditBibliography')}
              >
                <span className="rb-big-icon">
                  <IconBook size={BIG} />
                </span>
                <span>{t('zoteroBibliography')}</span>
              </button>
              <button
                className="rb-big"
                disabled={!hasDoc || zoteroBusy !== null}
                data-tip={t('zoteroRefreshTip')}
                onClick={() => void runZotero('refresh')}
              >
                <span className="rb-big-icon">
                  <IconRefresh size={BIG} />
                </span>
                <span>{t('zoteroRefresh')}</span>
              </button>
              <div className="rb-split-wrap">
                <button
                  className="rb-big"
                  disabled={!hasDoc || zoteroBusy !== null}
                  data-tip={t('zoteroDocumentSettingsTip')}
                  onClick={() => toggleDropdown(setDropdown, 'zotero-settings')}
                >
                  <span className="rb-big-icon">
                    <IconCitation size={BIG} />
                    <IconCaret />
                  </span>
                  <span>{t('zoteroDocumentSettings')}</span>
                </button>
                {dropdown === 'zotero-settings' && (
                  <div data-rb-panel="" className="layout-menu">
                    <button onClick={() => void runZotero('setDocPrefs')}>
                      {t('zoteroDocumentPreferences')}
                    </button>
                    <button onClick={() => void runZotero('removeCodes')}>
                      {t('zoteroRemoveCodes')}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="ribbon-group-label">{t('zoteroGroup')}</div>
          </div>

          <div className="ribbon-sep" />
        </>
      )}

=======
>>>>>>> theirs
      <div className="ribbon-group">
        <div className="ribbon-group-items">
          <button
            className="rb-big"
            disabled={!hasDoc}
            data-tip={t('ribbonTocTip')}
            onClick={() => runCommand('insert-toc')}
          >
            <span className="rb-big-icon">
              <IconToc size={BIG} />
            </span>
            <span>{t('ribbonToc')}</span>
          </button>
          <div className="rb-col rb-pair">
            <div className="rb-split-wrap">
              <button
                className="rb-small"
                disabled={!hasDoc}
                data-tip={t('ribbonAddText')}
                onClick={() => toggleDropdown(setDropdown, 'add-text')}
              >
                <IconAddText size={14} />
                <span className="rb-small-label">{t('ribbonAddText')}</span>
                <IconCaret />
              </button>
              {dropdown === 'add-text' && (
                <div data-rb-panel="" className="layout-menu">
                  <button onClick={() => pick('toc-add-text', '0')}>
                    {t('ribbonAddTextNone')}
                  </button>
                  {[1, 2, 3].map((n) => (
                    <button key={n} onClick={() => pick('toc-add-text', String(n))}>
                      {t('appParaOutlineLevelN', { n })}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="rb-small"
              disabled={!hasDoc}
              data-tip={t('ribbonTocUpdateTip')}
              onClick={() => runCommand('update-toc')}
            >
              <IconRefresh size={14} />
              <span className="rb-small-label">{t('ribbonTocUpdate')}</span>
            </button>
          </div>
        </div>
        <div className="ribbon-group-label">{t('ribbonToc')}</div>
      </div>

      <div className="ribbon-sep" />

      <div className="ribbon-group">
        <div className="ribbon-group-items">
          <button
            className="rb-big"
            disabled={!hasDoc}
            data-tip={t('ribbonFootnoteTip')}
<<<<<<< ours
            aria-keyshortcuts={shortcutAria('footnote') || undefined}
            onClick={() => onInsertNote('footnote')}
=======
            onClick={() => runCommand('insert-footnote')}
>>>>>>> theirs
          >
            <span className="rb-big-icon">
              <IconFootnote size={BIG} />
            </span>
            <span>{t('ribbonFootnote')}</span>
          </button>
          <button
            className="rb-big"
            disabled={!hasDoc}
            data-tip={t('ribbonEndnoteTip')}
<<<<<<< ours
            aria-keyshortcuts={shortcutAria('endnote') || undefined}
            onClick={() => onInsertNote('endnote')}
=======
            onClick={() => runCommand('insert-endnote')}
>>>>>>> theirs
          >
            <span className="rb-big-icon">
              <IconEndnote size={BIG} />
            </span>
            <span>{t('ribbonEndnote')}</span>
          </button>
          <div className="rb-col rb-pair">
            <RbCommand cmd="footnote-next" look="small">
              <IconNextFootnote size={14} />
            </RbCommand>
            <RbCommand cmd="view-footnotes" look="small">
              <IconShowNotes size={14} />
            </RbCommand>
          </div>
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupFootnotes')}</div>
      </div>

      <div className="ribbon-sep" />

      <div className="ribbon-group">
        <div className="ribbon-group-items">
          <div className="rb-split-wrap">
            <button
              className="rb-big"
              disabled={!hasDoc}
              data-tip={t('ribbonCitationTip')}
              onClick={() => toggleDropdown(setDropdown, 'citation')}
            >
              <span className="rb-big-icon">
                <IconCitation size={BIG} />
                <IconCaret />
              </span>
              <span>{t('ribbonCitation')}</span>
            </button>
            {dropdown === 'citation' && (
              <div data-rb-panel="" className="layout-menu">
                {sources.map((s) => (
                  <button
                    key={s.tag}
                    data-tip={s.title}
                    onClick={() => pick('insert-citation', s.tag)}
                  >
                    {citationText(s)} {s.title.slice(0, 12)}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setSourceOpen(true)
                    setDropdown(() => null)
                  }}
                >
                  {t('ribbonAddNewSource')}
                </button>
              </div>
            )}
          </div>
          <RbCommand cmd="citations-pane" look="big">
            <IconCitationsPane size={BIG} />
          </RbCommand>
          <div className="rb-col rb-pair">
            <div className="rb-split-wrap">
              <button
                className="rb-small"
                disabled={!hasDoc}
                data-tip={t('ribbonCitationStyle')}
                aria-haspopup="menu"
                onClick={() => toggleDropdown(setDropdown, 'citation-style')}
              >
                <IconCitation size={14} />
                <span className="rb-small-label">{t('ribbonCitationStyle')}</span>
                <small>{CITATION_STYLES.find((s) => s.id === citationStyle)?.name ?? ''}</small>
                <IconCaret />
              </button>
              {dropdown === 'citation-style' && (
                <div data-rb-panel="" className="layout-menu" role="menu">
                  {CITATION_STYLES.map((style) => (
                    <button
                      key={style.id}
                      role="menuitemradio"
                      aria-checked={style.id === citationStyle}
                      onClick={() => pick('citation-style', style.id)}
                    >
                      {style.name}
                      {style.id === citationStyle ? ' ✓' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="rb-small"
              disabled={!hasDoc}
              data-tip={t('ribbonBibliographyTip')}
              onClick={() => pick('insert-bibliography')}
            >
              <IconBook size={14} />
              <span className="rb-small-label">{t('ribbonBibliography')}</span>
            </button>
          </div>
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupCitationsBibliography')}</div>
      </div>

      <div className="ribbon-sep" />

      <div className="ribbon-group">
        <div className="ribbon-group-items">
          <button
            className="rb-big"
            disabled={!hasDoc}
            data-tip={t('ribbonCaptionTip')}
            onClick={() => runCommand('insert-caption')}
          >
            <span className="rb-big-icon">
              <IconCaption size={BIG} />
            </span>
            <span>{t('ribbonInsertCaption')}</span>
          </button>
          <RbCommand cmd="insert-table-of-figures" look="big">
            <IconToc size={BIG} />
          </RbCommand>
          <div className="rb-col rb-pair">
            <RbCommand cmd="update-table-of-figures" look="small">
              <IconRefresh size={14} />
            </RbCommand>
            <RbCommand cmd="insert-cross-reference" look="small">
              <IconRefresh size={14} />
            </RbCommand>
          </div>
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupCaptions')}</div>
      </div>

      <div className="ribbon-sep" />

      <div className="ribbon-group">
        <div className="ribbon-group-items">
          <RbCommand cmd="mark-index-entry" look="big">
            <IconMarkCitation size={BIG} />
          </RbCommand>
          <div className="rb-col rb-pair">
            <RbCommand cmd="insert-index" look="small">
              <IconIndex size={14} />
            </RbCommand>
            <RbCommand cmd="update-index" look="small">
              <IconRefresh size={14} />
            </RbCommand>
          </div>
        </div>
        <div className="ribbon-group-label">{t('ribbonIndex')}</div>
      </div>

      <div className="ribbon-sep" />

      <div className="ribbon-group">
        <div className="ribbon-group-items">
          <RbCommand cmd="toa-mark-citation" look="big">
            <IconMarkCitation size={BIG} />
          </RbCommand>
          <div className="rb-col rb-pair">
            <RbCommand cmd="toa-insert" look="small">
              <IconToa size={14} />
            </RbCommand>
            <RbCommand cmd="toa-update" look="small">
              <IconRefresh size={14} />
            </RbCommand>
          </div>
        </div>
        <div className="ribbon-group-label">{t('ribbonItAuthorities')}</div>
      </div>

      {sourceOpen && (
        <SourceModal sources={sources} onAdd={onAddSource} onClose={() => setSourceOpen(false)} />
      )}
    </>
  )
}

/* ================= Review ================= */
