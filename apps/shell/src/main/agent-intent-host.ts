import {
  createAgentIntent,
  isAgentIntentAction,
  parseAgentIntentTarget,
  type AgentIntent,
  type AgentIntentSource,
} from '@uniwork/practice-core'

const SCHEME = 'uniwork'
const INTENT_PATH = '/agent/intent'

const FORBIDDEN_QUERY_KEYS = new Set([
  'jwt',
  'access_token',
  'refresh_token',
  'id_token',
  'service_role',
  'apikey',
  'api_key',
  'file',
  'path',
  'url',
  'storage',
])

export type ParseAgentIntentUrlResult =
  | { ok: true; intent: AgentIntent }
  | { ok: false; reason: string }

function isAgentIntentPath(url: URL): boolean {
  const combined = `${url.hostname}${url.pathname}`.replace(/\/+$/, '')
  const normalized = (combined.startsWith('/') ? combined : `/${combined}`).replace(/\/+/g, '/')
  return normalized === INTENT_PATH
}

/**
 * Accept `uniwork://agent/intent?tab=…&action=…&text=…&summary=…&source=pwa`.
 * No JWT, file paths, or storage URLs in the query.
 */
export function parseAgentIntentUrl(raw: string): ParseAgentIntentUrlResult {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (url.protocol !== `${SCHEME}:`) {
    return { ok: false, reason: 'wrong_scheme' }
  }
  if (!isAgentIntentPath(url)) {
    return { ok: false, reason: 'wrong_path' }
  }
  for (const key of url.searchParams.keys()) {
    if (FORBIDDEN_QUERY_KEYS.has(key.toLowerCase())) {
      return { ok: false, reason: 'forbidden_query' }
    }
  }

  const tab = url.searchParams.get('tab')
  const skillDomain = url.searchParams.get('skillDomain')
  const target = parseAgentIntentTarget(tab, skillDomain)
  if (!target) {
    return { ok: false, reason: 'missing_target' }
  }

  const actionRaw = url.searchParams.get('action') ?? 'open'
  if (!isAgentIntentAction(actionRaw)) {
    return { ok: false, reason: 'bad_action' }
  }

  const sourceRaw = (url.searchParams.get('source') ?? 'pwa') as AgentIntentSource
  const source: AgentIntentSource =
    sourceRaw === 'desktop' || sourceRaw === 'hub' || sourceRaw === 'dev' ? sourceRaw : 'pwa'

  const consentParam = url.searchParams.get('consent')
  const requireConsent =
    consentParam === '0' || consentParam === 'false' ? false : source !== 'desktop'

  const summary =
    url.searchParams.get('summary')?.trim() ||
    url.searchParams.get('text')?.trim() ||
    `${actionRaw} ${tab ?? skillDomain ?? ''}`

  const text = url.searchParams.get('text')?.trim() || undefined
  const intentId = url.searchParams.get('intentId')?.trim() || undefined

  const fields: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    if (key.startsWith('f.') && value) {
      fields[key.slice(2)] = value.slice(0, 200)
    }
  }

  return {
    ok: true,
    intent: createAgentIntent({
      intentId,
      target,
      action: actionRaw,
      scope: 'local',
      source,
      summary: summary.slice(0, 200),
      text: text?.slice(0, 2000),
      fields: Object.keys(fields).length ? fields : undefined,
      requireConsent,
    }),
  }
}

export function isAgentIntentUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim())
    return url.protocol === `${SCHEME}:` && isAgentIntentPath(url)
  } catch {
    return false
  }
}
