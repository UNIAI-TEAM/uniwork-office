// Playwright reporter of the web e2e (finding RF-4): with WEB_E2E_REQUIRE_BUILD=1 a skipped test is a
// failed run. Every `test.skip` in these specs means "no bundle for this module", and the security
// proofs (html preview isolation, draft recovery, presenter, AI, smoke) must run, not be skipped.
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'

function required(): boolean {
  const v = process.env.WEB_E2E_REQUIRE_BUILD
  return v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false'
}

export default class FailOnSkipReporter implements Reporter {
  private skipped: string[] = []

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === 'skipped') this.skipped.push(test.titlePath().slice(1).join(' > '))
  }

  async onEnd(): Promise<{ status: FullResult['status'] } | undefined> {
    if (!required() || this.skipped.length === 0) return undefined
    console.error(
      `\nWEB_E2E_REQUIRE_BUILD is set and ${this.skipped.length} test(s) were skipped:\n` +
        this.skipped.map((t) => `  - ${t}`).join('\n'),
    )
    return { status: 'failed' }
  }

  printsToStdio(): boolean {
    return false
  }
}
