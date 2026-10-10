/**
 * In-frame UI of the web AI bridge (CONTRACT C16), plain DOM so every module (React or not) gets
 * the same one:
 *   - `showAiState()`: the typed failure card (one at a time, `data-ai-state="<code>"`), with an
 *     "AI settings" action where the user can fix it (missing / refused key),
 *   - `openAiSettingsDialog()`: the AI settings on the web = the UniWork-stored provider keys
 *     (GET / PUT / DELETE credentials, masked `key_hint`; the key is write-only and never read
 *     back), the provider + model this viewer uses, and the cloud tools / credits status.
 * Chrome: the shared .gs-imgdlg dialog of @genoffice/ui + ./ai-web.css (theme tokens only).
 * Strings: ../i18n/strings-ai-web.ts in the UI language.
 */
import '@genoffice/ui/image-dialogs.css'
import './ai-web.css'
import { webLanguage } from '../../../docs/bridge/browser'
import { aiWebText, type AiWebStringKey } from '../i18n/strings-ai-web'
import type { AiCredential, AiServerProvider, AiWebClient } from './client'
import { AiWebError, isAiWebError, type AiWebErrorCode } from './errors'
import type { WebAiState } from './web-ai'

const t = (key: AiWebStringKey, params?: Record<string, string | number>): string =>
  aiWebText(webLanguage(), key, params)

interface StateText {
  title: AiWebStringKey
  body: AiWebStringKey
  /** the card offers "AI settings" */
  settings?: boolean
  warn?: boolean
}

const STATES: Record<AiWebErrorCode, StateText> = {
  credits_exhausted: { title: 'aiWebStateCreditsTitle', body: 'aiWebStateCreditsBody', warn: true },
  entitlement_required: {
    title: 'aiWebStateEntitlementTitle',
    body: 'aiWebStateEntitlementBody',
    warn: true,
  },
  credential_missing: {
    title: 'aiWebStateKeyMissingTitle',
    body: 'aiWebStateKeyMissingBody',
    settings: true,
  },
  provider_auth_failed: {
    title: 'aiWebStateKeyRejectedTitle',
    body: 'aiWebStateKeyRejectedBody',
    settings: true,
    warn: true,
  },
  rate_limited: { title: 'aiWebStateRateTitle', body: 'aiWebStateRateBody' },
  provider_unreachable: { title: 'aiWebStateUnreachableTitle', body: 'aiWebStateUnreachableBody' },
  cloud_unavailable: { title: 'aiWebStateCloudTitle', body: 'aiWebStateCloudBody' },
  unauthorized: { title: 'aiWebStateSessionTitle', body: 'aiWebStateSessionBody', warn: true },
  provider_not_supported: {
    title: 'aiWebStateRefusedTitle',
    body: 'aiWebStateProviderBody',
    settings: true,
  },
  base_url_refused: {
    title: 'aiWebStateRefusedTitle',
    body: 'aiWebStateBaseUrlBody',
    settings: true,
  },
  bad_request: { title: 'aiWebStateRefusedTitle', body: 'aiWebStateRefusedBody' },
  unknown: { title: 'aiWebStateUnknownTitle', body: 'aiWebStateUnknownBody' },
}

function stateTexts(err: AiWebError, provider: string): { title: string; body: string } {
  const s = STATES[err.code]
  const params = { provider: provider || 'AI' }
  const body =
    err.code === 'rate_limited'
      ? err.retryAfterSec
        ? t('aiWebStateRateBody', { seconds: err.retryAfterSec })
        : t('aiWebStateRateBodyNow')
      : t(s.body, params)
  return { title: t(s.title, params), body }
}

/** the one-line text of a typed failure (the panel shows it as the turn's error) */
export function describeAiError(err: AiWebError, provider: string): string {
  const { title, body } = stateTexts(err, provider)
  return `${title}. ${body}`
}

const STATE_MARKER = 'data-ai-state'

export function hideAiState(): void {
  for (const el of document.querySelectorAll(`.ow-ai-state[${STATE_MARKER}]`)) el.remove()
}

function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = `gs-imgdlg-btn${cls ? ` ${cls}` : ''}`
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}

/** the typed failure card (replaces the previous one) */
export function showAiState(
  err: AiWebError,
  provider: string,
  actions: { openSettings(): Promise<void> | void },
): HTMLElement {
  hideAiState()
  const s = STATES[err.code]
  const { title, body } = stateTexts(err, provider)
  const card = document.createElement('div')
  card.className = 'ow-ai-state'
  card.setAttribute(STATE_MARKER, err.code)
  card.setAttribute('role', s.warn ? 'alert' : 'status')
  if (s.warn) card.dataset.tone = 'warn'
  const h = document.createElement('div')
  h.className = 'ow-ai-state-title'
  h.textContent = title
  const p = document.createElement('div')
  p.className = 'ow-ai-state-body'
  p.textContent = body
  const row = document.createElement('div')
  row.className = 'gs-imgdlg-actions'
  if (s.settings) {
    row.append(
      button(
        t('aiWebOpenSettings'),
        () => {
          card.remove()
          void actions.openSettings()
        },
        'primary',
      ),
    )
  }
  row.append(button(t('aiWebClose'), () => card.remove()))
  card.append(h, p, row)
  document.body.append(card)
  return card
}

// ------------------------------------------------------------------ settings dialog

export interface SettingsDialogDeps {
  load(): Promise<WebAiState>
  client: Pick<AiWebClient, 'saveCredential' | 'deleteCredential'>
  current(): Promise<{ provider: string; model: string }>
  choose(provider: string, model?: string): void
  /** genoffice can drive this provider id on the web */
  supported(id: string): boolean
  label(id: string): string
  models(id: string): string[]
}

const DIALOG_MARKER = 'ai-settings'
let openDialog: Promise<void> | null = null

function field(labelText: string, control: HTMLElement): HTMLLabelElement {
  const l = document.createElement('label')
  l.className = 'ow-ai-field'
  const span = document.createElement('span')
  span.textContent = labelText
  l.append(span, control)
  return l
}

function input(type: string, name: string): HTMLInputElement {
  const i = document.createElement('input')
  i.className = 'ow-ai-input'
  i.type = type
  i.name = name
  i.autocomplete = 'off'
  i.spellcheck = false
  return i
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  try {
    return d.toLocaleDateString(webLanguage(), {
      dateStyle: 'medium',
    } as Intl.DateTimeFormatOptions)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/** the AI settings dialog; resolves when it closes. A second call while open joins the first. */
export function openAiSettingsDialog(deps: SettingsDialogDeps): Promise<void> {
  if (openDialog) return openDialog
  openDialog = new Promise<void>((resolve) => {
    hideAiState()
    const root = document.createElement('div')
    root.className = 'gs-imgdlg-mask'
    root.setAttribute('data-office-web', DIALOG_MARKER)
    const box = document.createElement('div')
    box.className = 'gs-imgdlg ow-ai-dialog'
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')
    const title = document.createElement('div')
    title.className = 'gs-imgdlg-title'
    title.id = 'ow-ai-settings-title'
    title.textContent = t('aiWebSettingsTitle')
    box.setAttribute('aria-labelledby', title.id)
    const intro = document.createElement('div')
    intro.className = 'gs-imgdlg-hint'
    intro.textContent = t('aiWebSettingsIntro')
    const status = document.createElement('div')
    status.className = 'gs-imgdlg-hint'
    status.textContent = t('aiWebLoading')
    box.append(title, intro, status)
    root.append(box)
    document.body.append(root)

    const close = (): void => {
      document.removeEventListener('keydown', onKey, true)
      root.remove()
      openDialog = null
      resolve()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    document.addEventListener('keydown', onKey, true)

    void (async () => {
      let state: WebAiState
      let chosen: { provider: string; model: string }
      try {
        ;[state, chosen] = await Promise.all([deps.load(), deps.current()])
      } catch {
        status.textContent = t('aiWebLoadFailed')
        const actions = document.createElement('div')
        actions.className = 'gs-imgdlg-actions'
        actions.append(button(t('aiWebClose'), close))
        box.append(actions)
        return
      }
      status.remove()
      renderForm(box, state, chosen, deps, close)
    })()
  })
  return openDialog
}

function renderForm(
  box: HTMLElement,
  initial: WebAiState,
  chosen: { provider: string; model: string },
  deps: SettingsDialogDeps,
  close: () => void,
): void {
  let state = initial
  const providers = (): AiServerProvider[] =>
    state.credentials.providers.filter((p) => deps.supported(p.id))
  const credOf = (id: string): AiCredential | undefined =>
    state.credentials.items.find((c) => c.provider === id)

  const select = document.createElement('select')
  select.className = 'ow-ai-input'
  select.name = 'provider'
  const model = input('text', 'model')
  const models = document.createElement('datalist')
  models.id = 'ow-ai-models'
  model.setAttribute('list', models.id)
  const keyState = document.createElement('div')
  keyState.className = 'ow-ai-keystate'
  keyState.setAttribute('aria-live', 'polite')
  const key = input('password', 'api_key')
  const baseUrl = input('url', 'base_url')
  baseUrl.placeholder = 'https://'
  const baseUrlField = field(t('aiWebBaseUrl'), baseUrl)
  const error = document.createElement('div')
  error.className = 'ow-ai-error'
  error.setAttribute('role', 'alert')
  const save = button(t('aiWebSaveKey'), () => void onSave(), 'primary')
  const remove = button(t('aiWebRemoveKey'), () => void onRemove(), 'danger')
  const keyActions = document.createElement('div')
  keyActions.className = 'gs-imgdlg-actions'
  keyActions.append(remove, save)

  const fillProviders = (selected: string): void => {
    select.replaceChildren()
    for (const p of providers()) {
      const o = document.createElement('option')
      o.value = p.id
      const cred = credOf(p.id)
      o.textContent = cred?.key_hint ? `${deps.label(p.id)} · ${cred.key_hint}` : deps.label(p.id)
      select.append(o)
    }
    if (providers().some((p) => p.id === selected)) select.value = selected
  }

  const sync = (keepModel = false): void => {
    const id = select.value
    const row = providers().find((p) => p.id === id)
    const cred = credOf(id)
    const known = deps.models(id)
    models.replaceChildren(
      ...known.map((m) => {
        const o = document.createElement('option')
        o.value = m
        return o
      }),
    )
    if (!keepModel)
      model.value = id === chosen.provider && chosen.model ? chosen.model : (known[0] ?? '')
    keyState.textContent = cred
      ? t('aiWebKeySaved', { hint: cred.key_hint || '…' })
      : t('aiWebNoKey')
    keyState.dataset.saved = cred ? 'true' : 'false'
    key.value = ''
    key.placeholder = cred ? t('aiWebApiKeyKeep') : ''
    baseUrlField.hidden = !row?.requires_base_url
    baseUrl.value = cred?.base_url ?? ''
    remove.hidden = !cred
    error.textContent = ''
  }

  const busy = (on: boolean): void => {
    for (const b of [save, remove, select, key, baseUrl] as Array<
      HTMLButtonElement | HTMLInputElement | HTMLSelectElement
    >) {
      b.disabled = on
    }
  }

  const showError = (err: unknown): void => {
    const e = isAiWebError(err) ? err : new AiWebError({ code: 'unknown', status: 0 })
    error.textContent = describeAiError(e, deps.label(select.value))
  }

  async function reload(): Promise<void> {
    state = await deps.load()
    const id = select.value
    fillProviders(id)
    sync(true)
    renderCloud()
  }

  async function onSave(): Promise<void> {
    const id = select.value
    const apiKey = key.value.trim()
    if (!apiKey && !credOf(id)) {
      key.focus()
      return
    }
    busy(true)
    try {
      await deps.client.saveCredential(id, {
        ...(apiKey ? { api_key: apiKey } : {}),
        ...(!baseUrlField.hidden ? { base_url: baseUrl.value.trim() } : {}),
      })
      key.value = ''
      await reload()
    } catch (err) {
      showError(err)
    } finally {
      busy(false)
    }
  }

  async function onRemove(): Promise<void> {
    busy(true)
    try {
      await deps.client.deleteCredential(select.value)
      await reload()
    } catch (err) {
      showError(err)
    } finally {
      busy(false)
    }
  }

  const cloud = document.createElement('div')
  cloud.className = 'ow-ai-section'
  function renderCloud(): void {
    const c = state.cloud
    const head = document.createElement('div')
    head.className = 'ow-ai-section-title'
    head.textContent = t('aiWebCloudTitle')
    const line = document.createElement('div')
    line.className = 'gs-imgdlg-hint'
    line.dataset.aiCloud = c?.enabled ? 'on' : 'off'
    if (!c || !c.enabled) {
      line.textContent = t('aiWebCloudOff')
    } else {
      const cr = c.credits
      const parts = [
        cr.limit === null || cr.remaining === null
          ? t('aiWebCreditsUnlimited')
          : t('aiWebCredits', {
              remaining: cr.remaining.toLocaleString(webLanguage()),
              limit: cr.limit.toLocaleString(webLanguage()),
            }),
      ]
      if (cr.period_end) parts.push(t('aiWebCreditsRenew', { date: formatDate(cr.period_end) }))
      line.textContent = parts.join(' · ')
    }
    cloud.replaceChildren(head, line)
  }

  select.addEventListener('change', () => sync())
  const done = button(
    t('aiWebDone'),
    () => {
      if (select.value) deps.choose(select.value, model.value.trim() || undefined)
      close()
    },
    'primary',
  )
  const footer = document.createElement('div')
  footer.className = 'gs-imgdlg-actions'
  footer.append(done)

  const keyRow = document.createElement('div')
  keyRow.className = 'ow-ai-row'
  keyRow.append(keyState)

  fillProviders(chosen.provider)
  sync()
  renderCloud()
  box.append(
    field(t('aiWebProvider'), select),
    field(t('aiWebModel'), model),
    models,
    keyRow,
    field(t('aiWebApiKey'), key),
    baseUrlField,
    error,
    keyActions,
    cloud,
    footer,
  )
  select.focus()
}
