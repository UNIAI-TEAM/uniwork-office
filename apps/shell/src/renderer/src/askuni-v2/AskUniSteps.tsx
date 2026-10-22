import { useState } from 'react'
import type { ReactElement } from 'react'
import { useI18n, type StringKey } from '../locale'
import './askuni-v2.css'

// The kinds the server counts that mean something to a reader; "members" and "workload" are not documents.
const KINDS = ['task', 'meeting', 'document', 'project', 'chat'] as const
type Kind = (typeof KINDS)[number]

const KEYS: Record<Kind, { one: StringKey; many: StringKey }> = {
  task: { one: 'askUniV2StepTaskOne', many: 'askUniV2StepTaskMany' },
  meeting: { one: 'askUniV2StepMeetingOne', many: 'askUniV2StepMeetingMany' },
  document: { one: 'askUniV2StepDocumentOne', many: 'askUniV2StepDocumentMany' },
  project: { one: 'askUniV2StepProjectOne', many: 'askUniV2StepProjectMany' },
  chat: { one: 'askUniV2StepChatOne', many: 'askUniV2StepChatMany' },
}

/** "Looked at 24 tasks, 3 meetings" from the summed step counts; collapses to the per-kind lines. */
export function AskUniSteps({ counts }: { counts: Record<string, number> }): ReactElement | null {
  const { t, lang } = useI18n()
  const [open, setOpen] = useState(false)
  const plural = new Intl.PluralRules(lang)
  const parts = KINDS.filter((k) => (counts[k] ?? 0) > 0).map((k) => {
    const n = counts[k] ?? 0
    return t(plural.select(n) === 'one' ? KEYS[k].one : KEYS[k].many, { count: String(n) })
  })
  if (parts.length === 0) return null
  return (
    <div className="askuni-v2-steps">
      <button
        type="button"
        className="askuni-v2-steps-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          className="askuni-v2-steps-chevron"
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m6 3.5 4.5 4.5L6 12.5" />
        </svg>
        {t('askUniV2StepsSeen', { list: parts.join(', ') })}
      </button>
      {open ? (
        <ul className="askuni-v2-steps-list">
          {parts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
