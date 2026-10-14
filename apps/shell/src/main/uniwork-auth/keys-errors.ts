import {
  proxyErrorBodyFields,
  type AiTestFailureKind,
} from '@genoffice/ai-provider'

/**
 * Error codes, status mapping and the en/vi state copy of the UniWork BYOK proxy (contract §2.3),
 * shared by the desktop keys host (keys.ts).
 */

const PROXY_400_CODES: ReadonlySet<string> = new Set([
  'provider_not_supported',
  'base_url_refused',
  'invalid_request',
])

export type UniworkKeyErrorCode =
  | 'entitlement_required'
  | 'credential_missing'
  | 'provider_auth_failed'
  | 'rate_limited'
  | 'provider_unreachable'
  | 'provider_not_supported'
  | 'base_url_refused'
  | 'invalid_request'
  | 'unauthorized'
  | 'device_revoked'
  | 'forbidden'
  | 'cloud_unavailable'
  | 'credits_exhausted'
  | 'unknown'

const KNOWN_KEY_ERROR_CODES: ReadonlySet<string> = new Set<UniworkKeyErrorCode>([
  'entitlement_required',
  'credential_missing',
  'provider_auth_failed',
  'rate_limited',
  'provider_unreachable',
  'provider_not_supported',
  'base_url_refused',
  'invalid_request',
  'unauthorized',
  'device_revoked',
  'forbidden',
  'cloud_unavailable',
  'credits_exhausted',
  'unknown',
])

interface StateCopy {
  readonly entitlementTitle: string
  readonly entitlementBody: string
  readonly keyMissingTitle: string
  readonly keyMissingBody: string
  readonly keyRejectedTitle: string
  readonly keyRejectedBody: string
  readonly rateTitle: string
  readonly rateBody: string
  readonly rateBodyNow: string
  readonly unreachableTitle: string
  readonly unreachableBody: string
  readonly cloudTitle: string
  readonly cloudBody: string
  readonly sessionTitle: string
  readonly sessionBody: string
  readonly refusedTitle: string
  readonly refusedBody: string
  readonly baseUrlBody: string
  readonly providerBody: string
  readonly creditsTitle: string
  readonly creditsBody: string
  readonly unknownTitle: string
  readonly unknownBody: string
}

const STATE_COPY_EN: StateCopy = {
  entitlementTitle: 'AI is not in your plan',
  entitlementBody:
    "Your organization's UniWork plan does not include this AI feature. Ask your administrator.",
  keyMissingTitle: 'No AI key yet',
  keyMissingBody: 'Add an API key in AI settings to use the assistant.',
  keyRejectedTitle: 'The AI key was refused',
  keyRejectedBody: 'The provider refused the saved key. Replace it in AI settings.',
  rateTitle: 'Too many AI requests',
  rateBody: 'Wait {seconds} s and try again.',
  rateBodyNow: 'Wait a moment and try again.',
  unreachableTitle: 'AI provider unreachable',
  unreachableBody: 'UniWork could not reach the AI provider. Try again in a moment.',
  cloudTitle: 'Cloud tool unavailable',
  cloudBody: 'This UniWork AI tool is not set up on the server yet.',
  sessionTitle: 'Session expired',
  sessionBody: 'Sign in to UniWork again to continue.',
  refusedTitle: 'Request refused',
  refusedBody: 'The server refused the AI request.',
  baseUrlBody: 'This base URL is not allowed. Use a public https:// address.',
  providerBody: 'This provider is not supported.',
  creditsTitle: 'AI credits used up',
  creditsBody:
    'Your organization has used all UniWork AI credits for this period. Ask your administrator, or wait until they renew.',
  unknownTitle: 'AI request failed',
  unknownBody: 'Something went wrong. Try again.',
}

const STATE_COPY_VI: StateCopy = {
  entitlementTitle: 'Gói không bao gồm AI',
  entitlementBody:
    'Gói UniWork của tổ chức bạn không bao gồm tính năng AI này. Hãy liên hệ quản trị viên.',
  keyMissingTitle: 'Chưa có khóa AI',
  keyMissingBody: 'Thêm khóa API trong Cài đặt AI để dùng trợ lý.',
  keyRejectedTitle: 'Khóa AI bị từ chối',
  keyRejectedBody: 'Nhà cung cấp đã từ chối khóa đã lưu. Hãy thay khóa trong Cài đặt AI.',
  rateTitle: 'Quá nhiều yêu cầu AI',
  rateBody: 'Hãy chờ {seconds} giây rồi thử lại.',
  rateBodyNow: 'Hãy chờ một lát rồi thử lại.',
  unreachableTitle: 'Không kết nối được nhà cung cấp AI',
  unreachableBody: 'UniWork không kết nối được tới nhà cung cấp AI. Hãy thử lại sau ít phút.',
  cloudTitle: 'Công cụ đám mây chưa sẵn sàng',
  cloudBody: 'Công cụ UniWork AI này chưa được cấu hình trên máy chủ.',
  sessionTitle: 'Phiên đã hết hạn',
  sessionBody: 'Hãy đăng nhập lại UniWork để tiếp tục.',
  refusedTitle: 'Yêu cầu bị từ chối',
  refusedBody: 'Máy chủ đã từ chối yêu cầu AI.',
  baseUrlBody: 'Không cho phép Base URL này. Hãy dùng một địa chỉ https:// công khai.',
  providerBody: 'Nhà cung cấp này không được hỗ trợ.',
  creditsTitle: 'Đã hết tín dụng AI',
  creditsBody:
    'Tổ chức của bạn đã dùng hết tín dụng UniWork AI của kỳ này. Hãy liên hệ quản trị viên hoặc chờ kỳ mới.',
  unknownTitle: 'Yêu cầu AI thất bại',
  unknownBody: 'Đã xảy ra lỗi. Hãy thử lại.',
}

export type UniworkKeyErrorKind =
  AiTestFailureKind | 'not_entitled' | 'rate_limit' | 'unreachable' | 'bad_url' | 'quota'

export function errorKindForKeyCode(code: UniworkKeyErrorCode): UniworkKeyErrorKind {
  switch (code) {
    case 'entitlement_required':
      return 'not_entitled'
    case 'credential_missing':
    case 'provider_auth_failed':
    case 'unauthorized':
    case 'device_revoked':
    case 'forbidden':
      return 'invalid_key'
    case 'rate_limited':
      return 'rate_limit'
    case 'provider_unreachable':
    case 'cloud_unavailable':
      return 'unreachable'
    case 'base_url_refused':
      return 'bad_url'
    case 'credits_exhausted':
      return 'quota'
    case 'provider_not_supported':
    case 'invalid_request':
    case 'unknown':
      return 'failed'
  }
}

export class UniworkKeyError extends Error {
  readonly code: UniworkKeyErrorCode
  readonly status: number
  readonly serverCode?: string | undefined
  readonly retryAfterSeconds?: number | undefined
  readonly retryAfterSec?: number | undefined
  readonly errorKind: UniworkKeyErrorKind

  constructor(opts: {
    code: UniworkKeyErrorCode
    status: number
    serverCode?: string | undefined
    retryAfterSeconds?: number | undefined
    message?: string | undefined
  }) {
    super(opts.message ?? `uniwork key proxy failed: ${opts.code} (${opts.status})`)
    this.name = 'UniworkKeyError'
    this.code = opts.code
    this.status = opts.status
    if (opts.serverCode !== undefined) this.serverCode = opts.serverCode
    if (opts.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = opts.retryAfterSeconds
      this.retryAfterSec = opts.retryAfterSeconds
    }
    this.errorKind = errorKindForKeyCode(opts.code)
  }

  describe(lang = 'en', providerLabel?: string): string {
    return describeUniworkKeyError(this, lang, providerLabel)
  }
}

export function isUniworkKeyError(err: unknown): err is UniworkKeyError {
  return err instanceof UniworkKeyError
}

/**
 * Formats a `UniworkKeyError` into the localized state line matching the web frame's
 * `KEY_CODES` states (§2.3, `web/e2e/ai-web.spec.ts:15-22`).
 */
export function describeUniworkKeyError(
  err: UniworkKeyError,
  lang = 'en',
  providerLabel?: string,
): string {
  const copy = lang === 'vi' ? STATE_COPY_VI : STATE_COPY_EN
  let title: string
  let body: string
  switch (err.code) {
    case 'entitlement_required':
      title = copy.entitlementTitle
      body = copy.entitlementBody
      break
    case 'credential_missing':
      title = copy.keyMissingTitle
      body = copy.keyMissingBody
      break
    case 'provider_auth_failed':
      title = copy.keyRejectedTitle
      body = copy.keyRejectedBody
      break
    case 'rate_limited':
      title = copy.rateTitle
      body =
        err.retryAfterSeconds !== undefined
          ? copy.rateBody.replace('{seconds}', String(err.retryAfterSeconds))
          : copy.rateBodyNow
      break
    case 'provider_unreachable':
      title = copy.unreachableTitle
      body = copy.unreachableBody
      break
    case 'cloud_unavailable':
      title = copy.cloudTitle
      body = copy.cloudBody
      break
    case 'unauthorized':
    case 'device_revoked':
      title = copy.sessionTitle
      body = copy.sessionBody
      break
    case 'base_url_refused':
      title = copy.refusedTitle
      body = copy.baseUrlBody
      break
    case 'provider_not_supported':
      title = copy.refusedTitle
      body = copy.providerBody
      break
    case 'forbidden':
    case 'invalid_request':
      title = copy.refusedTitle
      body = copy.refusedBody
      break
    case 'credits_exhausted':
      title = copy.creditsTitle
      body = copy.creditsBody
      break
    default:
      title = copy.unknownTitle
      body = copy.unknownBody
      break
  }
  return providerLabel ? `${providerLabel} — ${title}: ${body}` : `${title}: ${body}`
}

function parseRetryAfterHeader(raw: string | null): number | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds)
  const at = Date.parse(trimmed)
  if (!Number.isNaN(at)) {
    const delta = Math.ceil((at - Date.now()) / 1_000)
    return delta > 0 ? delta : 1
  }
  return undefined
}

function keyErrorCodeForStatus(status: number, serverCode?: string): UniworkKeyErrorCode {
  if (serverCode && KNOWN_KEY_ERROR_CODES.has(serverCode)) {
    return serverCode as UniworkKeyErrorCode
  }
  switch (status) {
    case 400:
      return 'invalid_request'
    case 401:
      return 'unauthorized'
    case 402:
      return 'credits_exhausted'
    case 403:
      return 'entitlement_required'
    case 404:
      return 'credential_missing'
    case 424:
      return 'provider_auth_failed'
    case 429:
      return 'rate_limited'
    case 502:
      return 'provider_unreachable'
    case 503:
      return 'cloud_unavailable'
    default:
      return 'unknown'
  }
}

export async function keyErrorFromResponse(res: Response): Promise<UniworkKeyError> {
  const status = res.status
  let serverCode: string | undefined
  try {
    const body = await res.clone().json()
    serverCode = proxyErrorBodyFields(body).code
  } catch {
    // non-JSON error body
  }
  const code = keyErrorCodeForStatus(status, serverCode)
  const retryAfterSeconds =
    code === 'rate_limited' ? parseRetryAfterHeader(res.headers.get('retry-after')) : undefined
  return new UniworkKeyError({
    code,
    status,
    ...(serverCode !== undefined ? { serverCode } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  })
}

export async function isProxy400(res: Response): Promise<boolean> {
  if (res.status !== 400) return false
  try {
    const { code } = proxyErrorBodyFields(await res.clone().json())
    return typeof code === 'string' && PROXY_400_CODES.has(code)
  } catch {
    return false
  }
}
