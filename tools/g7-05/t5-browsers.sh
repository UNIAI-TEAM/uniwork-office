#!/usr/bin/env bash
# G7-05 W1 T5 Committed Browsers Runner:
# Runs web/e2e specs (modules-smoke docs-web size-gate open-refused) against an installed browser channel
# (chrome or msedge) with WEB_E2E_REQUIRE_BUILD=1, parses pass/skip/fail counts, and fails if any test is skipped or failed.
#
# Usage:
#   bash tools/g7-05/t5-browsers.sh --channel chrome|msedge
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHANNEL=""
OUT_DIR="${G7_05_OUT_DIR:-$REPO_ROOT/web/e2e/.results/g7-05}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel)
      CHANNEL="$2"
      shift 2
      ;;
    --output-dir)
      OUT_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$CHANNEL" != "chrome" && "$CHANNEL" != "msedge" ]]; then
  echo "ERROR: --channel must be 'chrome' or 'msedge' (got '$CHANNEL')." >&2
  exit 2
fi

cd "$REPO_ROOT"
mkdir -p "$OUT_DIR"

LOG_FILE="$OUT_DIR/t5-${CHANNEL}.log"
JSON_FILE="$OUT_DIR/t5-${CHANNEL}.json"

echo "[g7-05/t5:${CHANNEL}] Running web/e2e suite (modules-smoke docs-web size-gate open-refused) with WEB_E2E_REQUIRE_BUILD=1 WEB_E2E_CHANNEL=${CHANNEL}..."

set +e
WEB_E2E_REQUIRE_BUILD=1 WEB_E2E_CHANNEL="$CHANNEL" \
  npx playwright test -c web/e2e modules-smoke docs-web size-gate open-refused 2>&1 | tee "$LOG_FILE"
PW_EXIT=${PIPESTATUS[0]}
set -e

node - "$CHANNEL" "$PW_EXIT" "$LOG_FILE" "$JSON_FILE" <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs'
import { collectBuildMetadata, REPO_ROOT } from './tools/g7-05/lib.mjs'

const channel = process.argv[2]
const pwExit = Number(process.argv[3])
const logFile = process.argv[4]
const jsonFile = process.argv[5]

const logText = readFileSync(logFile, 'utf8')
const passedMatch = /(\d+)\s+passed/.exec(logText)
const skippedMatch = /(\d+)\s+skipped/.exec(logText)
const failedMatch = /(\d+)\s+failed/.exec(logText)
const didNotRunMatch = /(\d+)\s+did not run/.exec(logText)

const passed = passedMatch ? Number(passedMatch[1]) : 0
const skipped = skippedMatch ? Number(skippedMatch[1]) : 0
const failed = failedMatch ? Number(failedMatch[1]) : 0
const didNotRun = didNotRunMatch ? Number(didNotRunMatch[1]) : 0

const ok = pwExit === 0 && passed > 0 && skipped === 0 && failed === 0 && didNotRun === 0
const upper = channel === 'msedge' ? 'EDGE' : channel.toUpperCase()

const report = {
  test: `T5_${upper}`,
  channel,
  specs: ['modules-smoke', 'docs-web', 'size-gate', 'open-refused'],
  status: ok ? 'passed' : 'failed',
  playwrightExitCode: pwExit,
  counts: {
    passed,
    skipped,
    failed,
    didNotRun,
  },
  metadata: collectBuildMetadata(REPO_ROOT),
}

writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`G7_05_T5_${upper}_JSON_BEGIN`)
console.log(JSON.stringify(report, null, 2))
console.log(`G7_05_T5_${upper}_JSON_END`)

if (!ok) {
  console.error(
    `[g7-05/t5:${channel}] FAILED: pwExit=${pwExit}, passed=${passed}, skipped=${skipped}, failed=${failed}, didNotRun=${didNotRun}`,
  )
  process.exit(1)
}
console.log(
  `[g7-05/t5:${channel}] PASSED: ${passed} passed, ${skipped} skipped, ${failed} failed.`,
)
EOF
