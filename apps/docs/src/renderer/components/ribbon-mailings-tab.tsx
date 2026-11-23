<<<<<<< ours
import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { mergeFieldInstruction } from '@genoffice/docx-engine'
import type { MergeDataSource } from '../../shared/ipc'
import type { MailMergeRequest, MailMergeResponse } from '../mail-merge/output'
import { useI18n } from '../i18n/locale'
import { MailMergePanel } from './MailMergePanel'
import { IconCaret, IconChevronLeft, IconChevronRight, IconMail, IconMergeField } from './icons'
import { BIG, type SetDropdown, toggleDropdown } from './ribbon-tabs'
=======
import type { KeyboardEvent } from 'react'
import { mergeFieldInstruction } from '@genoffice/docx-engine'
import type { MergeDataSource } from '../../shared/ipc'
import { useI18n } from '../i18n/locale'
import {
  IconCaret,
  IconChevronLeft,
  IconChevronRight,
  IconMail,
  IconMergeField,
  IconEnvelope,
  IconLabels,
  IconRecipients,
  IconEditList,
  IconFilter,
  IconRules,
  IconEye,
  IconChevronFirst,
  IconChevronLast,
  IconSearch,
  IconFinishMerge,
} from './icons'
import { RbCommand, useCommandGreyed, useRunCommand } from './ribbon-command'
import { BIG, type SetDropdown, toggleDropdown } from './ribbon-tabs'
import type { MergeRange } from '../mail-merge/range'
>>>>>>> theirs

/**
 * The Mailings ribbon tab: the data source, the fields it holds, the preview
 * of a record and the merge.
 *
<<<<<<< ours
 * The tab holds what the user picked (the data source) and which record the
 * preview shows; the documents themselves are built by the app and written by
 * the main process. genoffice#2097.
 */

export interface MailingsTabProps {
  editor: Editor
=======
 * The app holds what the user picked (the data source), which record the
 * preview shows and the merge panel; the tab runs the commands. genoffice#2097.
 */

export interface MailingsTabProps {
>>>>>>> theirs
  hasDoc: boolean
  dropdown: string | null
  setDropdown: SetDropdown
  /** the data source the user picked, null when there is none yet */
  source: MergeDataSource | null
<<<<<<< ours
  /** open the file dialog and read the recipient list */
  onPickSource: () => void
  /** insert a merge field at the caret */
  onInsertField: (instr: string) => void
  /** build the documents and write them */
  onMerge: (request: MailMergeRequest) => Promise<MailMergeResponse>
}

export function MailingsTab({
  editor,
=======
  /** the record the preview shows */
  recordIndex: number
  onRecordIndex: (index: number | ((index: number) => number)) => void
  /** the records Finish & Merge takes */
  range: MergeRange
  onRange: (range: MergeRange) => void
}

/** a whole number typed into a box, or null when the box holds none */
const typedNumber = (text: string): number | null => {
  const n = Number(text.trim())
  return text.trim() !== '' && Number.isInteger(n) ? n : null
}

const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') e.currentTarget.blur()
}

export function MailingsTab({
>>>>>>> theirs
  hasDoc,
  dropdown,
  setDropdown,
  source,
<<<<<<< ours
  onPickSource,
  onInsertField,
  onMerge,
}: MailingsTabProps) {
  const { t } = useI18n()
  const [panelOpen, setPanelOpen] = useState(false)
  const [recordIndex, setRecordIndex] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // a new list starts at its first record; the old index may be past its end
  useEffect(() => setRecordIndex(0), [source?.path])

  const isOpen = dropdown === 'mergefield' && !!source && source.fields.length > 0
  useEffect(() => {
    if (!isOpen) return
    listRef.current?.querySelector<HTMLButtonElement>('button.rb-field-item')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setDropdown(() => null)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isOpen, setDropdown])

  const records = source?.records ?? []
  const hasRecords = records.length > 0
  const insertField = (name: string) => {
    onInsertField(mergeFieldInstruction(name))
    setDropdown(() => null)
  }
=======
  recordIndex,
  onRecordIndex: setRecordIndex,
  range,
  onRange,
}: MailingsTabProps) {
  const { t } = useI18n()

  const records = source?.records ?? []
  const hasRecords = records.length > 0
  const runCommand = useRunCommand()
  const rulesOff = useCommandGreyed('mailings-rules')
  const insertField = (name: string) => {
    runCommand('insert-field', mergeFieldInstruction(name))
    setDropdown(() => null)
  }
  const rangeChoices = [
    ['all', t('ribbonMergeRangeAll')],
    ['current', t('ribbonMergeRangeCurrent')],
    ['custom', t('ribbonMergeRangeCustom')],
  ] as const
  /** a From or To box; an emptied To runs to the last record */
  const rangeInput = (side: 'from' | 'to', title: string) => {
    const shown = range[side] ?? records.length
    return (
      <label className="layout-num mailings-field">
        <span>{title}</span>
        <input
          type="number"
          min={1}
          max={Math.max(records.length, 1)}
          step={1}
          disabled={!hasRecords || range.kind !== 'custom'}
          aria-label={title}
          key={`${side}:${shown}:${records.length}`}
          defaultValue={hasRecords ? shown : ''}
          onKeyDown={blurOnEnter}
          onBlur={(e) => {
            const typed = typedNumber(e.target.value)
            const next =
              typed === null
                ? side === 'from'
                  ? 1
                  : null
                : Math.min(Math.max(typed, 1), records.length)
            e.target.value = String(next ?? records.length)
            if (next !== range[side]) onRange({ ...range, [side]: next })
          }}
        />
      </label>
    )
  }
>>>>>>> theirs

  return (
    <>
      <div className="ribbon-group">
        <div className="ribbon-group-items">
<<<<<<< ours
=======
          <RbCommand cmd="tools-envelopes" look="big">
            <IconEnvelope size={BIG} />
          </RbCommand>
          <RbCommand cmd="tools-labels" look="big">
            <IconLabels size={BIG} />
          </RbCommand>
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupMailingsCreate')}</div>
      </div>

      <div className="ribbon-sep" />

      <div className="ribbon-group">
        <div className="ribbon-group-items">
>>>>>>> theirs
          <button
            className="rb-big"
            disabled={!hasDoc}
            data-tip={t('ribbonMailingsStartTip')}
<<<<<<< ours
            onClick={() => setPanelOpen(true)}
=======
            onClick={() => runCommand('mailings-start')}
>>>>>>> theirs
          >
            <span className="rb-big-icon">
              <IconMail size={BIG} />
            </span>
            <span>{t('ribbonMailingsStart')}</span>
          </button>
<<<<<<< ours
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupMailMerge')}</div>
=======
          <RbCommand cmd="mailings-select-recipients" look="big">
            <IconRecipients size={BIG} />
          </RbCommand>
          <RbCommand cmd="mailings-edit-recipients" look="big">
            <IconEditList size={BIG} />
          </RbCommand>
          <RbCommand cmd="mailings-filter-recipients" look="big">
            <IconFilter size={BIG} />
          </RbCommand>
        </div>
        <div className="ribbon-group-label">{t('ribbonMailingsStart')}</div>
>>>>>>> theirs
      </div>

      <div className="ribbon-sep" />

      <div className="ribbon-group">
        <div className="ribbon-group-items">
          <div className="rb-split-wrap">
            <button
<<<<<<< ours
              ref={triggerRef}
              className="rb-big"
              disabled={!hasDoc || !source || source.fields.length === 0}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              data-tip={t('ribbonMailingsInsertFieldTip')}
              onClick={() => toggleDropdown(setDropdown, 'mergefield')}
              onKeyDown={(e) => {
                if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isOpen) {
                  e.preventDefault()
                  setDropdown(() => 'mergefield')
                }
              }}
=======
              className="rb-big"
              disabled={!hasDoc || !source || source.fields.length === 0}
              data-tip={t('ribbonMailingsInsertFieldTip')}
              onClick={() => toggleDropdown(setDropdown, 'mergefield')}
>>>>>>> theirs
            >
              <span className="rb-big-icon">
                <IconMergeField size={BIG} />
                <IconCaret />
              </span>
              <span>{t('ribbonMailingsInsertField')}</span>
            </button>
<<<<<<< ours
            {isOpen && source && (
              <div
                ref={listRef}
                data-rb-panel=""
                role="menu"
                aria-label={t('ribbonMailingsFields')}
                className="layout-menu layout-menu-scroll rb-field-list"
                onKeyDown={(e) => {
                  if (
                    e.key !== 'ArrowDown' &&
                    e.key !== 'ArrowUp' &&
                    e.key !== 'Home' &&
                    e.key !== 'End'
                  ) {
                    return
                  }
                  const items = [
                    ...(listRef.current?.querySelectorAll<HTMLButtonElement>(
                      'button.rb-field-item',
                    ) ?? []),
                  ]
                  if (items.length === 0) return
                  e.preventDefault()
                  const cur = items.indexOf(document.activeElement as HTMLButtonElement)
                  const next =
                    e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? items.length - 1
                        : e.key === 'ArrowDown'
                          ? cur < 0
                            ? 0
                            : (cur + 1) % items.length
                          : cur <= 0
                            ? items.length - 1
                            : cur - 1
                  items[next]?.focus()
                }}
              >
                <div className="layout-menu-head rb-drop-title">{t('ribbonMailingsFields')}</div>
                {source.fields.map((name) => (
                  <button
                    key={name}
                    role="menuitem"
                    className="rb-field-item"
                    onClick={() => insertField(name)}
                  >
                    {name}
=======
            {dropdown === 'mergefield' && source && (
              <div data-rb-panel="" className="rb-field-list">
                <div className="rb-drop-title">{t('ribbonMailingsFields')}</div>
                {source.fields.map((name) => (
                  <button key={name} className="rb-field-item" onClick={() => insertField(name)}>
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="rb-split-wrap">
            <button
              className="rb-big"
              disabled={rulesOff}
              data-tip={t('ribbonRules')}
              onClick={() => toggleDropdown(setDropdown, 'rules')}
            >
              <span className="rb-big-icon">
                <IconRules size={BIG} />
                <IconCaret />
              </span>
              <span>{t('ribbonRules')}</span>
            </button>
            {dropdown === 'rules' && (
              <div data-rb-panel="" className="layout-menu">
                {(
                  [
                    ['ask', 'ribbonRulesAsk'],
                    ['fillIn', 'ribbonRulesFillIn'],
                    ['if', 'ribbonRulesIf'],
                    ['mergeRec', 'ribbonRulesMergeRec'],
                    ['mergeSeq', 'ribbonRulesMergeSeq'],
                    ['next', 'ribbonRulesNext'],
                    ['nextIf', 'ribbonRulesNextIf'],
                    ['set', 'ribbonRulesSet'],
                    ['skipIf', 'ribbonRulesSkipIf'],
                  ] as const
                ).map(([rule, label]) => (
                  <button
                    key={rule}
                    onClick={() => {
                      runCommand('mailings-rules', rule)
                      setDropdown(() => null)
                    }}
                  >
                    {t(label)}
>>>>>>> theirs
                  </button>
                ))}
              </div>
            )}
          </div>
<<<<<<< ours
        </div>
        <div className="ribbon-group-label">{t('ribbonMailingsInsertField')}</div>
=======
          <RbCommand cmd="mailings-update-labels" look="big">
            <IconLabels size={BIG} />
          </RbCommand>
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupMailingsWriteInsert')}</div>
>>>>>>> theirs
      </div>

      <div className="ribbon-sep" />

      <div className="ribbon-group">
        <div className="ribbon-group-items">
<<<<<<< ours
          <button
            className="rb-big"
            disabled={!hasRecords}
            data-tip={t('ribbonMailingsPrevTip')}
            onClick={() => setRecordIndex((index) => Math.max(index - 1, 0))}
          >
            <span className="rb-big-icon">
              <IconChevronLeft size={BIG} />
            </span>
            <span>{t('ribbonMailingsPrev')}</span>
          </button>
          <button
            className="rb-big"
            disabled={!hasRecords}
            data-tip={t('ribbonMailingsNextTip')}
            onClick={() => setRecordIndex((index) => Math.min(index + 1, records.length - 1))}
          >
            <span className="rb-big-icon">
              <IconChevronRight size={BIG} />
            </span>
            <span>{t('ribbonMailingsNext')}</span>
          </button>
        </div>
        <div className="ribbon-group-label">
          {hasRecords
            ? t('ribbonMailingsRecord', { n: recordIndex + 1, total: records.length })
            : t('ribbonMailingsNoSource')}
        </div>
      </div>

      {panelOpen && (
        <MailMergePanel
          editor={editor}
          source={source}
          onPickSource={onPickSource}
          onInsertField={onInsertField}
          onMerge={onMerge}
          recordIndex={recordIndex}
          onRecordIndex={setRecordIndex}
          onClose={() => setPanelOpen(false)}
        />
      )}
=======
          <RbCommand cmd="mailings-preview-results" look="big">
            <IconEye size={BIG} />
          </RbCommand>
          <div className="rb-col rb-pair">
            <div className="rb-row">
              <button
                className="rb-icon"
                disabled={!hasRecords}
                data-tip={t('ribbonMailingsFirst')}
                aria-label={t('ribbonMailingsFirst')}
                // command-exempt: steps the tab's own preview record
                onClick={() => setRecordIndex(0)}
              >
                <IconChevronFirst size={16} />
              </button>
              <button
                className="rb-icon"
                disabled={!hasRecords}
                data-tip={t('ribbonMailingsPrevTip')}
                aria-label={t('ribbonMailingsPrev')}
                // command-exempt: steps the tab's own preview record
                onClick={() => setRecordIndex((index) => Math.max(index - 1, 0))}
              >
                <IconChevronLeft size={16} />
              </button>
              <label className="layout-num mailings-field" data-tip={t('ribbonMailingsRecordBox')}>
                <span>{t('ribbonMailingsRecordBox')}</span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(records.length, 1)}
                  step={1}
                  disabled={!hasRecords}
                  aria-label={t('ribbonMailingsRecordBox')}
                  key={`${recordIndex}:${records.length}`}
                  defaultValue={hasRecords ? recordIndex + 1 : ''}
                  onKeyDown={blurOnEnter}
                  onBlur={(e) => {
                    const typed = typedNumber(e.target.value)
                    const next =
                      typed === null
                        ? recordIndex
                        : Math.min(Math.max(typed, 1), records.length) - 1
                    e.target.value = String(next + 1)
                    if (next !== recordIndex) setRecordIndex(next)
                  }}
                />
              </label>
              <button
                className="rb-icon"
                disabled={!hasRecords}
                data-tip={t('ribbonMailingsNextTip')}
                aria-label={t('ribbonMailingsNext')}
                // command-exempt: steps the tab's own preview record
                onClick={() => setRecordIndex((index) => Math.min(index + 1, records.length - 1))}
              >
                <IconChevronRight size={16} />
              </button>
              <button
                className="rb-icon"
                disabled={!hasRecords}
                data-tip={t('ribbonMailingsLast')}
                aria-label={t('ribbonMailingsLast')}
                // command-exempt: steps the tab's own preview record
                onClick={() => setRecordIndex(records.length - 1)}
              >
                <IconChevronLast size={16} />
              </button>
            </div>
            <div className="rb-row">
              <RbCommand cmd="mailings-find-recipient" look="small">
                <IconSearch size={14} />
              </RbCommand>
              <span className="mailings-status" role="status" data-testid="mailings-record-status">
                {hasRecords
                  ? t('ribbonMailingsRecord', { n: recordIndex + 1, total: records.length })
                  : t('ribbonMailingsNoSource')}
              </span>
            </div>
          </div>
        </div>
        <div className="ribbon-group-label">{t('ribbonPreviewResults')}</div>
      </div>

      <div className="ribbon-sep" />

      <div className="ribbon-group">
        <div className="ribbon-group-items">
          <div className="rb-col rb-pair">
            <div className="rb-split-wrap">
              <button
                className="rb-small"
                disabled={!hasRecords}
                aria-label={t('ribbonMergeRange')}
                data-tip={t('ribbonMergeRange')}
                onClick={() => toggleDropdown(setDropdown, 'merge-range')}
              >
                <IconFilter size={14} />
                <span className="rb-small-label">
                  {rangeChoices.find(([kind]) => kind === range.kind)?.[1]}
                </span>
                <IconCaret />
              </button>
              {dropdown === 'merge-range' && (
                <div data-rb-panel="" className="layout-menu">
                  {rangeChoices.map(([kind, label]) => (
                    <button
                      key={kind}
                      role="menuitemradio"
                      aria-checked={range.kind === kind}
                      // command-exempt: sets the merge's own range, as the record buttons set its record
                      onClick={() => {
                        onRange({ ...range, kind })
                        setDropdown(() => null)
                      }}
                    >
                      {label}
                      {range.kind === kind ? ' ✓' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="rb-row">
              {rangeInput('from', t('ribbonMergeRangeFrom'))}
              {rangeInput('to', t('ribbonMergeRangeTo'))}
            </div>
          </div>
        </div>
        <div className="ribbon-group-label">{t('ribbonMergeRange')}</div>
      </div>

      <div className="ribbon-sep" />

      <div className="ribbon-group">
        <div className="ribbon-group-items">
          <RbCommand cmd="mailings-finish-merge" look="big">
            <IconFinishMerge size={BIG} />
          </RbCommand>
        </div>
        <div className="ribbon-group-label">{t('ribbonGroupMailingsFinish')}</div>
      </div>
>>>>>>> theirs
    </>
  )
}
