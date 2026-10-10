import type {
  AiMediaProviderConfig,
  AiMediaProviderId,
  AiSearchProviderId,
  AiTestFailureKind,
} from '@genoffice/ai-provider'
import type { AiConnectionTestResult, FileSearchSettings, HomeApi } from '../../shared/home-api'
import type { StringKey, TFunc } from './locale'
import { cloudTestVerdict } from './UniworkCloudPane'

/**
 * Settings → AI Media & Search "Test connection": what each block checks and
 * what its pill says. A failure reads as a product message in the UI language
 * from the failure kind; the provider's raw text ("HTTP 401: ...") stays in the
 * main process log.
 */

/** a tested block: the four capabilities plus the decision-model reranker of the local file search */
export type TestedBlock = 'image' | 'analysis' | 'video' | 'search' | 'rerank'

export type TestResult = { ok: boolean; error?: string }

/** what one block runs: the UniWork cloud, a media vendor, a search provider or the reranker */
export type BlockCheck =
  | { block: TestedBlock; kind: 'cloud' }
  | {
      block: TestedBlock
      kind: 'media'
      provider: AiMediaProviderId
      config: AiMediaProviderConfig
    }
  | { block: TestedBlock; kind: 'search'; provider: AiSearchProviderId; apiKey: string }
  | { block: TestedBlock; kind: 'rerank'; settings: FileSearchSettings }

type TestApi = Pick<
  HomeApi,
  'uniworkCloudRefresh' | 'testAiMediaSettings' | 'testAiSearchSettings' | 'testFileSearchRerank'
>

const FAILURE_KEYS: Record<AiTestFailureKind, StringKey> = {
  not_entitled: 'cloudStateNotEntitled',
  credits_exhausted: 'cloudStateExhausted',
  invalid_key: 'aiTestErrInvalidKey',
  network: 'aiTestErrNetwork',
  limit: 'aiTestErrLimit',
  unavailable: 'aiTestErrUnavailable',
  misconfigured: 'aiTestErrMisconfigured',
  failed: 'setAiTestFail',
}

/** the pill text for a failure kind */
export function testFailureText(kind: AiTestFailureKind | undefined, t: TFunc): string {
  return t(FAILURE_KEYS[kind ?? 'failed'])
}

/** a connection test answer as a block verdict; a failure keeps only its product message */
export function connectionTestResult(
  raw: AiConnectionTestResult | null | undefined,
  t: TFunc,
): TestResult {
  if (!raw) return { ok: true }
  return raw.ok ? { ok: true } : { ok: false, error: testFailureText(raw.errorKind, t) }
}

/**
 * Runs the checks of every block at once. The UniWork cloud status is re-read
 * on every test, whichever blocks use the cloud: the main process publishes the
 * answer to the open settings, so a plan or credits change shows in the notice
 * without reopening the pane (the other blocks do not wait for it). Blocks
 * sharing a vendor share that vendor's one check.
 */
export async function runConnectionTests(
  checks: BlockCheck[],
  api: TestApi,
  t: TFunc,
): Promise<Partial<Record<TestedBlock, TestResult>>> {
  const failed = (): TestResult => ({ ok: false, error: testFailureText('failed', t) })
  const cloud = (api.uniworkCloudRefresh?.() ?? Promise.resolve(null))
    .then((status) => cloudTestVerdict(status, t))
    .catch((): TestResult => ({ ok: false, error: t('cloudStateUnavailable') }))
  const vendors = new Map<AiMediaProviderId, Promise<TestResult>>()
  const vendor = (id: AiMediaProviderId, config: AiMediaProviderConfig) => {
    let pending = vendors.get(id)
    if (!pending) {
      pending = Promise.resolve(api.testAiMediaSettings?.({ provider: id, config })).then((raw) =>
        connectionTestResult(raw, t),
      )
      vendors.set(id, pending)
    }
    return pending
  }
  const run = (check: BlockCheck): Promise<TestResult> => {
    switch (check.kind) {
      case 'cloud':
        return cloud
      case 'media':
        return vendor(check.provider, check.config)
      case 'search':
        return Promise.resolve(
          api.testAiSearchSettings?.({ provider: check.provider, apiKey: check.apiKey }),
        ).then((raw) => connectionTestResult(raw, t))
      case 'rerank':
        return Promise.resolve(api.testFileSearchRerank?.(check.settings)).then((raw) =>
          connectionTestResult(raw, t),
        )
    }
  }
  const results: Partial<Record<TestedBlock, TestResult>> = {}
  await Promise.all(
    checks.map(async (check) => {
      try {
        results[check.block] = await run(check)
      } catch {
        results[check.block] = failed()
      }
    }),
  )
  return results
}
