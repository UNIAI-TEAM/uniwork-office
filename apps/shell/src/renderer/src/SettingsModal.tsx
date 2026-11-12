import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import {
  AI_CUSTOM_FONT_MAX_PX,
  AI_CUSTOM_FONT_MIN_PX,
  DEFAULT_AI_PANEL_PREFS,
  Dropdown,
  aiPanelFontPx,
  clampAiCustomFontSize,
} from '@genoffice/ui'
import type { AiFontSize, AiPanelPrefs, AiPanelSide } from '@genoffice/ui'
import {
  CSV_IMPORT_DEFAULT_LIMIT_MB,
  CSV_IMPORT_LIMIT_CHOICES_MB,
  type CliLinkState,
  type DefaultAppStatus,
  type LegalDoc,
} from '../../shared/home-api'
import type { UpdateUiState } from '../../shared/update-api'
import { useI18n } from './locale'
import type { StringKey } from './locale'
import type { DocTheme, UiTheme } from '../../shared/home-api'
import appIcon from './assets/app-icon.png'
import legal from '../../shared/legal.json'
import { AccountPane } from './AccountPane'
import type { AccountController } from './account-model'
import { BackupStoragePane } from './BackupStoragePane'
import { UniAiPwaPane } from './UniAiPwaPane'
import {
  UniworkCloudAccountRows,
  UniworkCloudToolsSwitch,
  useUniworkCloudStatus,
} from './UniworkCloudPane'
import { IntegrationsPane, skillUpdateDue } from './IntegrationsPane'
import { FoundSkills } from './FoundSkills'
import { SyncCenterPane } from './SyncCenterPane'
import './settings.css'

// ── Settings modal (opened from the sidebar Settings entry) ─
// Genspark-style two-pane dialog: section nav on the left, fields on the right.
// All values go through the existing home IPC; nothing is stored locally.

// sorted by ISO 639 language code — native-script labels have no natural
// shared alphabet, so the code is the ordering key
const LANG_OPTIONS = [
  { value: 'ar', label: 'العربية' },
  { value: 'cs', label: 'Čeština' },
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'he', label: 'עברית' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'it', label: 'Italiano' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'ms', label: 'Bahasa Melayu' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'pl', label: 'Polski' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
  { value: 'th', label: 'ไทย' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'zh', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
] as const

// GenMail's option order: follow-system first, then the manual picks
const THEME_OPTIONS = [
  { value: 'system', labelKey: 'themeSystem' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
] as const satisfies readonly { value: UiTheme; labelKey: StringKey }[]

// Document page theme (genoffice#1811): the canvas/paper preference the editors follow;
// 'follow' keeps the pre-existing behavior of riding the UI theme
const DOC_THEME_OPTIONS = [
  { value: 'follow', labelKey: 'docThemeFollowApp' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
] as const satisfies readonly { value: DocTheme; labelKey: StringKey }[]

const AI_FONT_SIZE_OPTIONS = [
  { value: 'default', labelKey: 'aiFontSizeDefault' },
  { value: 'large', labelKey: 'aiFontSizeLarge' },
  { value: 'xlarge', labelKey: 'aiFontSizeXLarge' },
  { value: 'custom', labelKey: 'aiFontSizeCustom' },
] as const satisfies readonly { value: AiFontSize; labelKey: StringKey }[]

const CHANNEL_OPTIONS = [
  { value: 'stable', labelKey: 'channelStable' },
  { value: 'beta', labelKey: 'channelBeta' },
] as const satisfies readonly { value: 'stable' | 'beta'; labelKey: StringKey }[]

/** px stepper for the custom AI panel text size; in-range values apply live,
 * out-of-range or partial input is clamped on blur */
function CustomFontSizeInput({
  value,
  label,
  onCommit,
}: {
  value: number
  label: string
  onCommit: (px: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const shown = editing ? draft : String(value)
  const commit = (raw: string) => {
    const px = clampAiCustomFontSize(raw)
    if (px !== null && px !== value) onCommit(px)
  }
  return (
    <label className="set-num">
      <input
        type="number"
        className="set-input set-num-input"
        aria-label={label}
        min={AI_CUSTOM_FONT_MIN_PX}
        max={AI_CUSTOM_FONT_MAX_PX}
        step={1}
        value={shown}
        onFocus={() => {
          setDraft(String(value))
          setEditing(true)
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = Number(e.target.value)
          if (Number.isInteger(n) && n >= AI_CUSTOM_FONT_MIN_PX && n <= AI_CUSTOM_FONT_MAX_PX) {
            onCommit(n)
          }
        }}
        onBlur={() => {
          commit(draft)
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      <span className="set-num-unit">px</span>
    </label>
  )
}

export type SettingsSectionId =
  | 'account'
  | 'uniai'
  | 'general'
  | 'backup'
  | 'integrations'
  | 'skills'
  | 'about'
  // G5-10: Settings › Sync center (S2)
  | 'sync'

export type SectionId = SettingsSectionId

const SECTIONS: readonly { id: SectionId; labelKey: StringKey }[] = [
  { id: 'account', labelKey: 'setSecAccount' },
  { id: 'sync', labelKey: 'uwSyncTitle' },
  // shortcut: UniAI pane hidden for now (pane code kept); re-add this entry to show it again
  // { id: 'uniai', labelKey: 'setSecUniAi' },
  { id: 'general', labelKey: 'setSecGeneral' },
  { id: 'backup', labelKey: 'setSecBackup' },
  { id: 'integrations', labelKey: 'setSecIntegrations' },
  { id: 'skills', labelKey: 'setSecSkills' },
  { id: 'about', labelKey: 'setSecAbout' },
]

function SectionIcon({ id }: { id: SectionId }) {
  if (id === 'account') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="5.2" r="2.9" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M2.7 13.6a5.5 5.5 0 0 1 10.6 0"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (id === 'skills') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3 3.5h6.5l3.5 3.5v5.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M9.5 3.5V7H13" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M5 10.5h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  if (id === 'integrations') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M5.5 2v3M10.5 2v3M4 5h8v2.5a4 4 0 0 1-8 0V5ZM8 11.5V14"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (id === 'general') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2 5h8M13 5h1M2 11h1M6 11h8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="11.5" cy="5" r="1.7" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="4.5" cy="11" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    )
  }
  if (id === 'backup') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M4.5 11.5A3.5 3.5 0 0 1 5 4.6a4 4 0 0 1 7.6 1.2A2.8 2.8 0 0 1 12 12H5"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8 7.5v4M6.5 10 8 11.5 9.5 10"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (id === 'sync') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M13 6.5A5 5 0 0 0 3.6 5M3 9.5A5 5 0 0 0 12.4 11M3.5 2.5V5h2.5M12.5 13.5V11H10"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (id === 'uniai') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect
          x="2.5"
          y="2.5"
          width="11"
          height="11"
          rx="3"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path
          d="M5.2 10.2 6.4 5.8h1.3L9 10.2M5.7 8.6h2.6M11 5.8v4.4"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7.4v3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="5.1" r="0.8" fill="currentColor" />
    </svg>
  )
}

/** label-over-value field row with an optional right-aligned action */
function Field({
  label,
  value,
  valueTitle,
  action,
}: {
  label: string
  value: string
  valueTitle?: string
  action?: ReactNode
}) {
  return (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-label">{label}</div>
        <div className="set-field-value" data-tip={valueTitle}>
          {value}
        </div>
      </div>
      {action}
    </div>
  )
}

/** where an outside entry point lands when it opens the modal */
export interface SettingsTarget {
  section: SectionId
}

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled):not([hidden]), textarea, a[href], summary, [tabindex]:not([tabindex="-1"])'

export interface SettingsModalProps {
  /** the UniWork account (owned by the sidebar AccountEntry); absent in isolated renders */
  account?: AccountController
  onClose: () => void
  /** an installed skill is older than the bundled one: dot on the Integrations entry */
  skillUpdateDue?: boolean
  onSkillUpdateDue?: (due: boolean) => void
  /** section shown when the modal opens */
  initialSection?: SettingsSectionId
  /** open on this section instead of the account page */
  target?: SettingsTarget | null
}

export function SettingsModal({
  account,
  onClose,
  skillUpdateDue: updateDue = false,
  onSkillUpdateDue,
  initialSection = 'general',
  target,
}: SettingsModalProps) {
  const { lang, setLang, t } = useI18n()
  const [section, setSection] = useState<SectionId>(target?.section ?? initialSection)
  useEffect(() => {
    if (target) setSection(target.section)
  }, [target])
  useEffect(() => {
    if (account?.signOutPrompt || account?.signOutNotice) setSection('account')
  }, [account?.signOutPrompt, account?.signOutNotice])
  const requestClose = () => {
    // same order as Escape: a queued notice stays until no prompt is open
    if (account?.signOutPrompt) account.cancelSignOut?.()
    else if (account?.signOutNotice) account.acknowledgeSignOutNotice?.()
    onClose()
  }
  const goToSection = (id: SectionId) => {
    if (id !== section) setSection(id)
  }
  const [theme, setTheme] = useState<UiTheme>('system')
  const [docTheme, setDocTheme] = useState<DocTheme>('follow')
  const [csvLimitMb, setCsvLimitMb] = useState(CSV_IMPORT_DEFAULT_LIMIT_MB)
  const [saveDir, setSaveDir] = useState('')
  const [autoSaveOn, setAutoSaveOn] = useState(false)
  const [restoreSessionOn, setRestoreSessionOn] = useState(false)
  const [autoUpdateCheckOn, setAutoUpdateCheckOn] = useState(true)
  const [autoUpdateSupported, setAutoUpdateSupported] = useState(false)
  const [defaultApp, setDefaultApp] = useState<DefaultAppStatus | null>(null)
  const [defaultAppBusy, setDefaultAppBusy] = useState(false)
  const [defaultAppFailed, setDefaultAppFailed] = useState(false)
  const [cliLink, setCliLink] = useState<CliLinkState | null>(null)
  const [cliLinkBusy, setCliLinkBusy] = useState(false)
  const [aiPrefs, setAiPrefs] = useState<AiPanelPrefs>(DEFAULT_AI_PANEL_PREFS)
  const [channel, setChannel] = useState<'stable' | 'beta'>('stable')
  const [pinnedChannel, setPinnedChannel] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [updateState, setUpdateState] = useState<UpdateUiState | null>(null)
  const [legalOpenFailed, setLegalOpenFailed] = useState(false)

  // About: open a shipped legal file; a missing file or a refused viewer shows an inline note
  const openLegal = (doc: LegalDoc): void => {
    setLegalOpenFailed(false)
    const open = window.aiOffice.openLegalDoc
    if (!open) {
      setLegalOpenFailed(true)
      return
    }
    void open(doc).then(
      (ok) => {
        if (!ok) setLegalOpenFailed(true)
      },
      () => setLegalOpenFailed(true),
    )
  }

  useEffect(() => {
    let alive = true
    void window.aiOffice.getTheme?.().then((th) => {
      if (alive) setTheme(th)
    })
    void window.aiOffice.getDocumentTheme?.().then((th) => {
      if (alive) setDocTheme(th)
    })
    void window.aiOffice.getDefaultSaveDir?.().then((dir) => {
      if (alive && dir) setSaveDir(dir)
    })
    void window.aiOffice.getAutoSaveDefault?.().then((v) => {
      if (alive) setAutoSaveOn(v.on)
    })
    void window.aiOffice.getCsvImportLimit?.().then((mb) => {
      if (alive && mb > 0) setCsvLimitMb(mb)
    })
    void window.aiOffice.getRestoreLastSession?.().then((on) => {
      if (alive) setRestoreSessionOn(on)
    })
    void window.aiOffice.getDefaultAppStatus?.().then((st) => {
      if (alive) setDefaultApp(st)
    })
    void window.aiOffice.getCliLinkStatus?.().then((st) => {
      if (alive) setCliLink(st)
    })
    void window.aiOffice.getAiPanelPrefs?.().then((prefs) => {
      if (alive) setAiPrefs(prefs)
    })
    void window.aiOffice.getUpdateChannel?.().then((ch) => {
      if (alive) setChannel(ch)
    })
    void window.aiOffice.getPinnedUpdateChannel?.().then((ch) => {
      if (alive) setPinnedChannel(ch)
    })
    void window.aiOffice.getAutoUpdateCheck?.().then((st) => {
      if (alive && st) {
        setAutoUpdateCheckOn(st.on)
        setAutoUpdateSupported(st.supported)
      }
    })
    void window.aiOffice.getAppVersion?.().then((v) => {
      if (alive && v) setAppVersion(v)
    })
    // a rejected invoke (main process not ready, a shell whose preload does
    // not expose the channel) must not surface as an unhandled rejection;
    // without a known state the About row simply stays hidden
    void window.aiOffice
      .getUpdateState?.()
      .then((s) => {
        if (alive) setUpdateState(s)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  // live update state: the About row offers the update as soon as one is known
  useEffect(() => {
    const off = window.aiOffice.onUpdateStateChanged?.((s) => setUpdateState(s))
    return () => off?.()
  }, [])

  // modal focus: start on the current section (unless an in-pane alertdialog already claimed focus),
  // Tab cycles inside, closing hands focus back
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialogRef.current?.querySelector('[role="alertdialog"]')) {
      dialogRef.current?.querySelector<HTMLElement>('.set-nav-item.active')?.focus()
    }
    return () => opener?.focus()
  }, [])
  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.getClientRects().length > 0,
    )
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // read through a ref so the listener is registered once, not per render
  const escapeRef = useRef<() => void>(() => undefined)
  escapeRef.current = () => {
    if (account?.signOutPrompt) account.cancelSignOut?.()
    else if (account?.signOutNotice) account.acknowledgeSignOutNotice?.()
    else requestClose()
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') escapeRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const applyTheme = (next: UiTheme) => {
    setTheme(next)
    void window.aiOffice.setTheme(next)
    if (next === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', next)
  }

  const applyDocumentTheme = (next: DocTheme) => {
    setDocTheme(next)
    void window.aiOffice.setDocumentTheme(next)
  }

  const updateAiPrefs = (patch: Partial<AiPanelPrefs>) => {
    setAiPrefs((prev) => ({ ...prev, ...patch }))
    // a refused write re-reads what is actually stored
    void window.aiOffice
      .setAiPanelPrefs(patch)
      .then(setAiPrefs, () => window.aiOffice.getAiPanelPrefs?.().then(setAiPrefs))
  }

  const changeSaveDir = () => {
    void window.aiOffice.pickDefaultSaveDir?.().then((dir) => {
      if (dir) setSaveDir(dir)
    })
  }

  // Windows only opens the system page; re-read ownership when the user comes back
  useEffect(() => {
    if (!defaultApp?.manualOnly) return
    const refresh = () => {
      void window.aiOffice.getDefaultAppStatus?.().then(setDefaultApp)
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [defaultApp?.manualOnly])

  const claimDefaultApp = () => {
    setDefaultAppBusy(true)
    setDefaultAppFailed(false)
    void window.aiOffice
      .setDefaultApp()
      .then((st) => {
        setDefaultApp(st)
        if (!st.manualOnly && st.state !== 'default') setDefaultAppFailed(true)
      })
      .catch(() => setDefaultAppFailed(true))
      .finally(() => setDefaultAppBusy(false))
  }

  // the PATH command is never set up behind the user's back: only this button does it
  const addCliLink = () => {
    setCliLinkBusy(true)
    void window.aiOffice
      .installCliLink()
      .then(setCliLink)
      .catch(() => undefined)
      .finally(() => setCliLinkBusy(false))
  }

  const cliLinkDesc = (() => {
    if (!cliLink) return ''
    if (cliLink.state === 'present') return t('setCliLinkReady')
    if (cliLink.state === 'blocked' && cliLink.manual)
      return t('setCliLinkBlocked', { cmd: cliLink.manual })
    return t('setCliLinkDesc', { cmd: cliLink.command ?? '' })
  })()

  const defaultAppDesc = (() => {
    if (!defaultApp) return ''
    if (defaultAppFailed) return t('setDefaultAppFailed')
    if (defaultApp.state === 'default') return t('setDefaultAppIs')
    if (defaultApp.state === 'other' && defaultApp.others.length > 0)
      return t('setDefaultAppOther', { app: defaultApp.others.join(', ') })
    return t('setDefaultAppDesc')
  })()

  const loggedIn = account?.status?.loggedIn ?? false
  const signIn = account?.signIn ?? (() => undefined)
  const cloud = useUniworkCloudStatus()

  return (
    <div
      className="set-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      <div
        ref={dialogRef}
        className="set-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings')}
        onKeyDown={trapTab}
      >
        <div className="set-header">
          <h2 className="set-title">{t('settings')}</h2>
          <button className="set-close" onClick={requestClose} aria-label={t('setClose')}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2 2l10 10M12 2L2 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="set-body">
          <nav className="set-nav" aria-label={t('settings')}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`set-nav-item${section === s.id ? ' active' : ''}`}
                aria-current={section === s.id}
                onClick={() => goToSection(s.id)}
              >
                <SectionIcon id={s.id} />
                {t(s.labelKey)}
                {s.id === 'integrations' && updateDue && (
                  <span className="set-nav-dot" role="img" aria-label={t('intgUpdateDue')} />
                )}
              </button>
            ))}
          </nav>
          <div className="set-pane">
            {section === 'account' && (
              <>
                <h3 className="set-pane-title">{t('setSecAccount')}</h3>
                {account && <AccountPane account={account} />}
                {loggedIn && <UniworkCloudAccountRows status={cloud} />}
                {loggedIn && cloud?.enabled && <UniworkCloudToolsSwitch />}
                {loggedIn && (
                  <button type="button" className="sc-link" onClick={() => goToSection('sync')}>
                    {t('uwSyncOpenFromSettings')}
                  </button>
                )}
              </>
            )}
            {section === 'sync' && (
              <SyncCenterPane
                onSignIn={signIn}
                onSignOut={account?.signOut}
                onSwitchAccount={() => goToSection('account')}
              />
            )}
            {section === 'backup' && <BackupStoragePane loggedIn={loggedIn} onLogin={signIn} />}
            {section === 'uniai' && <UniAiPwaPane />}
            {section === 'general' && (
              <>
                <h3 className="set-pane-title">{t('setSecGeneral')}</h3>
                <h4 className="set-pane-subtitle">{t('setGrpAppearance')}</h4>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-label">{t('language')}</div>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={lang}
                    ariaLabel={t('language')}
                    options={LANG_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                    onPick={(v) => setLang(v as typeof lang)}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-label">{t('theme')}</div>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={theme}
                    ariaLabel={t('theme')}
                    options={THEME_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => applyTheme(v as UiTheme)}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-label">{t('documentTheme')}</div>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={docTheme}
                    ariaLabel={t('documentTheme')}
                    options={DOC_THEME_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => applyDocumentTheme(v as DocTheme)}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('csvImportLimit')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={String(csvLimitMb)}
                    ariaLabel={t('csvImportLimit')}
                    options={CSV_IMPORT_LIMIT_CHOICES_MB.map((mb) => ({
                      value: String(mb),
                      label: `${mb} MB`,
                    }))}
                    onPick={(v) => {
                      const mb = Number(v)
                      if (!Number.isInteger(mb)) return
                      setCsvLimitMb(mb)
                      void window.aiOffice.setCsvImportLimit?.(mb)
                    }}
                  />
                </div>
                <h4 className="set-pane-subtitle">{t('setGrpAiPanel')}</h4>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-label">{t('setAiPanelSide')}</div>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={aiPrefs.side}
                    ariaLabel={t('setAiPanelSide')}
                    options={[
                      { value: 'left', label: t('aiPanelSideLeft') },
                      { value: 'right', label: t('aiPanelSideRight') },
                    ]}
                    onPick={(side) => updateAiPrefs({ side: side as AiPanelSide })}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-label">{t('setAiFontSize')}</div>
                  </div>
                  {aiPrefs.fontSize === 'custom' && (
                    <CustomFontSizeInput
                      value={aiPrefs.customFontSize}
                      label={t('aiFontSizeCustom')}
                      onCommit={(px) => updateAiPrefs({ customFontSize: px })}
                    />
                  )}
                  <Dropdown
                    className="set-dd"
                    value={aiPrefs.fontSize}
                    ariaLabel={t('setAiFontSize')}
                    options={AI_FONT_SIZE_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => {
                      const fontSize = v as AiFontSize
                      // start the custom size from the preset being left so nothing jumps
                      updateAiPrefs(
                        fontSize === 'custom' && aiPrefs.fontSize !== 'custom'
                          ? { fontSize, customFontSize: aiPanelFontPx(aiPrefs) }
                          : { fontSize },
                      )
                    }}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAiSpellcheck')}</div>
                      <div className="set-field-desc">{t('setAiSpellcheckDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={aiPrefs.spellcheck}
                    aria-label={t('setAiSpellcheck')}
                    onClick={() => updateAiPrefs({ spellcheck: !aiPrefs.spellcheck })}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAiShowSidebar')}</div>
                      <div className="set-field-desc">{t('setAiShowSidebarDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={aiPrefs.showAiSidebar}
                    aria-label={t('setAiShowSidebar')}
                    onClick={() => updateAiPrefs({ showAiSidebar: !aiPrefs.showAiSidebar })}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAiOpenInNewDocs')}</div>
                      <div className="set-field-desc">{t('setAiOpenInNewDocsDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={aiPrefs.openInNewDocs}
                    aria-label={t('setAiOpenInNewDocs')}
                    onClick={() => updateAiPrefs({ openInNewDocs: !aiPrefs.openInNewDocs })}
                  />
                </div>
                <h4 className="set-pane-subtitle">{t('setGrpFiles')}</h4>
                <Field
                  label={t('saveLocation')}
                  value={saveDir || '—'}
                  valueTitle={saveDir}
                  action={
                    <button className="set-btn" onClick={changeSaveDir}>
                      {t('setChange')}
                    </button>
                  }
                />
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAutoSave')}</div>
                      <div className="set-field-desc">{t('setAutoSaveDesc')}</div>
                      <div className="set-field-desc">{t('setAutoSaveUniworkNote')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={autoSaveOn}
                    aria-label={t('setAutoSave')}
                    onClick={() => {
                      const next = !autoSaveOn
                      setAutoSaveOn(next)
                      // a refused write puts the switch back instead of showing a state that was not saved
                      void window.aiOffice
                        .setAutoSaveDefault?.(next)
                        .catch(() => setAutoSaveOn(!next))
                    }}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setRestoreSession')}</div>
                      <div className="set-field-desc">{t('setRestoreSessionDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={restoreSessionOn}
                    aria-label={t('setRestoreSession')}
                    onClick={() => {
                      const next = !restoreSessionOn
                      setRestoreSessionOn(next)
                      void window.aiOffice
                        .setRestoreLastSession?.(next)
                        .catch(() => setRestoreSessionOn(!next))
                    }}
                  />
                </div>
                {((defaultApp && defaultApp.state !== 'unsupported') ||
                  (cliLink && cliLink.state !== 'unsupported')) && (
                  <h4 className="set-pane-subtitle">{t('setGrpSystem')}</h4>
                )}
                {defaultApp && defaultApp.state !== 'unsupported' && (
                  <div className="set-field">
                    <div className="set-field-text">
                      <div className="set-field-stack">
                        <div className="set-field-label">{t('setDefaultApp')}</div>
                        <div className="set-field-desc">{defaultAppDesc}</div>
                      </div>
                    </div>
                    <button
                      className="set-btn"
                      disabled={defaultAppBusy || defaultApp.state === 'default'}
                      onClick={claimDefaultApp}
                    >
                      {defaultApp.manualOnly
                        ? t('setDefaultAppOpenSettings')
                        : t('setDefaultAppSet')}
                    </button>
                  </div>
                )}
                {cliLink && cliLink.state !== 'unsupported' && (
                  <div className="set-field">
                    <div className="set-field-text">
                      <div className="set-field-stack">
                        <div className="set-field-label">{t('setCliLink')}</div>
                        <div className="set-field-desc">{cliLinkDesc}</div>
                        {cliLink.state === 'present' && cliLink.pathHint && (
                          <code className="set-field-desc">{cliLink.pathHint}</code>
                        )}
                      </div>
                    </div>
                    <button
                      className="set-btn"
                      disabled={cliLinkBusy || cliLink.state === 'present'}
                      onClick={addCliLink}
                    >
                      {t('setCliLinkInstall')}
                    </button>
                  </div>
                )}
              </>
            )}
            {section === 'integrations' && (
              <IntegrationsPane t={t} onStatus={(st) => onSkillUpdateDue?.(skillUpdateDue(st))} />
            )}
            {section === 'skills' && <FoundSkills t={t} />}
            {section === 'about' && (
              <>
                <h3 className="set-pane-title">{t('setSecAbout')}</h3>
                <div className="set-about-hero">
                  <img className="set-about-logo" src={appIcon} alt="" />
                  <div className="set-about-id">
                    <div className="set-about-name">{legal.product}</div>
                    <div className="set-about-tagline">{t('onbSubtitle1')}</div>
                  </div>
                </div>
                <Field label={t('versionLabel')} value={appVersion || '—'} />
                {updateState && (
                  <div className="set-field">
                    <div className="set-field-text">
                      <div className="set-field-label">{t('setUpdateAvailableLabel')}</div>
                    </div>
                    <button
                      type="button"
                      className="set-btn primary"
                      onClick={() => void window.aiOffice.openUpdateDialog?.()}
                    >
                      {updateState.phase === 'downloading'
                        ? t('setUpdateDownloading', {
                            percent: Math.round(updateState.percent),
                          })
                        : updateState.phase === 'downloaded'
                          ? t('setUpdateRestart')
                          : t('setUpdateTo', { version: updateState.version })}
                    </button>
                  </div>
                )}
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('updateChannel')}</div>
                      {(pinnedChannel ?? channel) === 'beta' && (
                        <div className="set-field-desc">{t('setChannelBetaDesc')}</div>
                      )}
                    </div>
                  </div>
                  {pinnedChannel !== null ? (
                    <span className="set-about-channel-pinned">
                      {pinnedChannel === 'dev'
                        ? t('channelDev')
                        : pinnedChannel === 'beta'
                          ? t('channelBeta')
                          : pinnedChannel}
                    </span>
                  ) : (
                    <Dropdown
                      className="set-dd"
                      value={channel}
                      ariaLabel={t('updateChannel')}
                      options={CHANNEL_OPTIONS.map((opt) => ({
                        value: opt.value,
                        label: t(opt.labelKey),
                      }))}
                      onPick={(v) => {
                        const next = v === 'beta' ? 'beta' : 'stable'
                        setChannel(next)
                        void window.aiOffice.setUpdateChannel(next)
                      }}
                    />
                  )}
                </div>
                {pinnedChannel !== null && (
                  <p className="set-field-desc">{t('updateChannelPinnedNote')}</p>
                )}
                {autoUpdateSupported && (
                  <div className="set-field">
                    <div className="set-field-text">
                      <div className="set-field-stack">
                        <div className="set-field-label">{t('setAutoUpdateCheck')}</div>
                        <div className="set-field-desc">{t('setAutoUpdateCheckDesc')}</div>
                      </div>
                    </div>
                    <button
                      className="set-switch"
                      role="switch"
                      aria-checked={autoUpdateCheckOn}
                      aria-label={t('setAutoUpdateCheck')}
                      onClick={() => {
                        const next = !autoUpdateCheckOn
                        setAutoUpdateCheckOn(next)
                        void window.aiOffice
                          .setAutoUpdateCheck?.(next)
                          .catch(() => setAutoUpdateCheckOn(!next))
                      }}
                    />
                  </div>
                )}
                <div className="set-about-legal">
                  <p className="set-about-copyright">
                    {t('setAboutCopyright', {
                      year: legal.copyrightYear,
                      company: legal.company,
                    })}
                  </p>
                  <p className="set-about-attribution">
                    {t('setAboutAttribution', {
                      product: legal.product,
                      upstream: legal.upstream.name,
                      upstreamCopyright: legal.upstream.copyright,
                      license: legal.upstream.license,
                    })}
                  </p>
                  <div className="set-about-legal-links">
                    <button
                      type="button"
                      className="set-btn set-about-legal-btn"
                      onClick={() => openLegal('license')}
                    >
                      {t('setAboutLicense')}
                    </button>
                    <button
                      type="button"
                      className="set-btn set-about-legal-btn"
                      onClick={() => openLegal('notice')}
                    >
                      {t('setAboutLegalNotices')}
                    </button>
                    <button
                      type="button"
                      className="set-btn set-about-legal-btn"
                      onClick={() => openLegal('thirdParty')}
                    >
                      {t('setAboutThirdPartyLicenses')}
                    </button>
                  </div>
                  {legalOpenFailed && (
                    <p className="set-about-legal-error" role="alert">
                      {t('setAboutLegalOpenFailed')}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
