#!/usr/bin/env bash
# G7-05 W2/W2b: Build the 3 Linux x86_64 desktop packages required for the T3/T4 upgrade & rollback matrix:
#   1. N+1 (synthetic unreleased test build at current branch HEAD with APP_STORE_LEVEL = 3, version 1.0.0-g705n1)
#   2. N'  (tag v1.0.0-beta.3, 4bdba928d1210df9b04bfdaf549bbcdd6419d206, APP_STORE_LEVEL = 2, version 1.0.0)
#   3. pre-N' (tag v0.11.0-dev.6, fcfcd29ddb989b1497993204486bc110e0ae8b04, before G5-04g store-level gate, version 0.11.0)
#
# Architecture (W2b fix):
# - Never copies or runs tool scripts from /tmp (apply-n1-patch.mjs runs directly from $REPO_ROOT/tools/g7-05/
#   and uses only Node built-in modules).
# - Builds N+1 from HEAD in $REPO_ROOT, restores the exact 6 patched files via `git checkout --`, and verifies
#   `git status --porcelain` is clean so the main checkout and its node_modules remain untouched.
# - Builds each older SHA (N' and pre-N') in its own isolated `git worktree add --detach <dir> <sha>` with its
#   own `npm ci` and `npm run dist:linux`, copies artifacts into $OUT_DIR, and removes the worktree afterwards.
# - Manifest step prints each build's SHA, version, artifact names, byte sizes, and sha256 digests, and fails
#   loudly with per-build errors if any of the three builds fails.
#
# Usage:
#   bash tools/g7-05/build-upgrade-matrix.sh [--output-dir <dir>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="${G7_05_MATRIX_OUT_DIR:-$REPO_ROOT/apps/shell/release/g7-05-matrix}"

N_PRIME_SHA="4bdba928d1210df9b04bfdaf549bbcdd6419d206"
PRE_N_PRIME_SHA="fcfcd29ddb989b1497993204486bc110e0ae8b04"
N1_VERSION="1.0.0-g705n1"

PATCHED_FILES=(
  "apps/shell/src/main/uniwork-sync/store-level.ts"
  "apps/shell/src/main/uniwork-docs/binding-store.ts"
  "apps/shell/src/main/uniwork-sync/store/layer.ts"
  "package.json"
  "apps/shell/package.json"
)

while [[ $# -gt 0 ]]; do
  case "$1" in
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

OUT_DIR="$(mkdir -p "$OUT_DIR" && cd "$OUT_DIR" && pwd)"
cd "$REPO_ROOT"
mkdir -p "$OUT_DIR/n1" "$OUT_DIR/n-prime" "$OUT_DIR/pre-n-prime"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "ERROR: build-upgrade-matrix.sh must run on a Linux host (got $(uname -s))." >&2
  exit 1
fi

# Ensure Electron binary is present in main checkout if npm ci ran with --ignore-scripts.
if [[ ! -f "$REPO_ROOT/node_modules/electron/path.txt" ]]; then
  echo "[g7-05/matrix-build] Installing Electron binary via node_modules/electron/install.js..."
  node "$REPO_ROOT/node_modules/electron/install.js"
fi

# Ensure rpmbuild (rpm), strace, and desktop utilities are installed on the VM.
if ! command -v rpmbuild >/dev/null 2>&1 || ! command -v strace >/dev/null 2>&1 || ! command -v desktop-file-validate >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    echo "[g7-05/matrix-build] Installing rpm, strace, desktop-file-utils, xdg-utils..."
    sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rpm strace desktop-file-utils xdg-utils >/dev/null
  fi
fi

# Ensure older commit objects (N' and pre-N') are available in git even if the VM clone was shallow.
for req_sha in "$N_PRIME_SHA" "$PRE_N_PRIME_SHA"; do
  if ! git -C "$REPO_ROOT" cat-file -e "${req_sha}^{commit}" 2>/dev/null; then
    echo "[g7-05/matrix-build] Commit $req_sha missing locally; fetching tags and history from origin..."
    git -C "$REPO_ROOT" fetch --unshallow --tags origin || git -C "$REPO_ROOT" fetch --tags origin "$N_PRIME_SHA" "$PRE_N_PRIME_SHA"
  fi
done

ORIG_HEAD_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
ACTIVE_WORKTREES=()

restore_n1_patch() {
  git -C "$REPO_ROOT" checkout -- "${PATCHED_FILES[@]}" >/dev/null 2>&1 || true
}

cleanup_all() {
  restore_n1_patch
  for wt in "${ACTIVE_WORKTREES[@]:-}"; do
    if [[ -n "$wt" ]]; then
      git -C "$REPO_ROOT" worktree remove --force "$wt" >/dev/null 2>&1 || true
      rm -rf "$wt" >/dev/null 2>&1 || true
    fi
  done
  git -C "$REPO_ROOT" worktree prune >/dev/null 2>&1 || true
}
trap cleanup_all EXIT

assert_main_checkout_clean() {
  local context="$1"
  local cur_sha
  cur_sha="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  if [[ "$cur_sha" != "$ORIG_HEAD_SHA" ]]; then
    echo "ERROR: [$context] Main checkout HEAD changed from $ORIG_HEAD_SHA to $cur_sha" >&2
    return 1
  fi
  local dirty
  dirty="$(git -C "$REPO_ROOT" status --porcelain)"
  if [[ -n "$dirty" ]]; then
    echo "ERROR: [$context] Main checkout git status --porcelain is not clean:" >&2
    echo "$dirty" >&2
    return 1
  fi
  return 0
}

build_n1_from_head() {
  local log_file="$OUT_DIR/n1-build.log"
  rm -f "$log_file"
  rm -rf "$OUT_DIR/n1"/*
  echo "=================================================================="
  echo "[g7-05/matrix-build] 1/3 Building N+1 (${N1_VERSION}, APP_STORE_LEVEL=3) from HEAD (${ORIG_HEAD_SHA})"
  echo "=================================================================="
  local rc=0
  (
    set -euo pipefail
    cd "$REPO_ROOT"
    node "$REPO_ROOT/tools/g7-05/apply-n1-patch.mjs" --repo-root "$REPO_ROOT" --version "$N1_VERSION" --store-level 3
    BUILD_DIR="$OUT_DIR/n1" CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:linux
    rm -rf "$OUT_DIR/n1/linux-unpacked"
  ) 2>&1 | tee "$log_file" || rc=$?

  # Always restore the 6 patched files immediately and verify the main checkout is clean.
  git -C "$REPO_ROOT" checkout -- "${PATCHED_FILES[@]}"
  if ! assert_main_checkout_clean "after-N+1-build"; then
    rc=1
  fi
  return "$rc"
}

build_older_sha_in_worktree() {
  local step_label="$1"
  local role_desc="$2"
  local target_sha="$3"
  local dest_dir="$4"
  local log_file="$5"

  rm -f "$log_file"
  rm -rf "$dest_dir"/*
  echo "=================================================================="
  echo "[g7-05/matrix-build] ${step_label} Building ${role_desc} (${target_sha}) in isolated git worktree"
  echo "=================================================================="

  local wt_dir
  wt_dir="$(mktemp -d "/tmp/g7-05-wt-${step_label//[^a-zA-Z0-9]/-}-XXXXXX")"
  ACTIVE_WORKTREES+=("$wt_dir")

  local rc=0
  (
    set -euo pipefail
    git -C "$REPO_ROOT" worktree add --detach "$wt_dir" "$target_sha"
    cd "$wt_dir"
    local wt_sha
    wt_sha="$(git rev-parse HEAD)"
    if [[ "$wt_sha" != "$target_sha" ]]; then
      echo "ERROR: Worktree HEAD ($wt_sha) does not match target SHA ($target_sha)" >&2
      exit 1
    fi

    echo "[g7-05/matrix-build] Running npm ci in worktree $wt_dir (${target_sha})..."
    npm ci

    if [[ ! -f "$wt_dir/node_modules/electron/path.txt" ]]; then
      echo "[g7-05/matrix-build] Installing Electron binary in worktree via node_modules/electron/install.js..."
      node "$wt_dir/node_modules/electron/install.js"
    fi

    # Pre-seed compiled Rust dependency artifacts from main checkout if present so cargo build --release
    # inside npm run dist:linux reuses unchanged crate deps while rebuilding xlsx-sidecar for this SHA.
    if [[ -d "$REPO_ROOT/apps/sheets/native/xlsx-engine/target" && ! -d "$wt_dir/apps/sheets/native/xlsx-engine/target" ]]; then
      echo "[g7-05/matrix-build] Seeding apps/sheets/native/xlsx-engine/target cache into worktree..."
      cp -a "$REPO_ROOT/apps/sheets/native/xlsx-engine/target" "$wt_dir/apps/sheets/native/xlsx-engine/target"
    fi

    echo "[g7-05/matrix-build] Running npm run dist:linux in worktree $wt_dir (${target_sha})..."
    CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:linux

    mkdir -p "$dest_dir"
    shopt -s nullglob
    local copied=0
    for artifact in "$wt_dir"/apps/shell/release/*.deb "$wt_dir"/apps/shell/release/*.AppImage "$wt_dir"/apps/shell/release/*.rpm; do
      cp -f "$artifact" "$dest_dir/"
      copied=$((copied + 1))
    done
    if [[ "$copied" -eq 0 ]]; then
      echo "ERROR: No Linux artifacts (*.deb / *.AppImage) produced in $wt_dir/apps/shell/release" >&2
      exit 1
    fi
  ) 2>&1 | tee "$log_file" || rc=$?

  git -C "$REPO_ROOT" worktree remove --force "$wt_dir" >/dev/null 2>&1 || true
  rm -rf "$wt_dir" >/dev/null 2>&1 || true
  git -C "$REPO_ROOT" worktree prune >/dev/null 2>&1 || true

  if ! assert_main_checkout_clean "after-worktree-${step_label}"; then
    rc=1
  fi
  return "$rc"
}

N1_BUILD_RC=0
build_n1_from_head || N1_BUILD_RC=$?

N_PRIME_BUILD_RC=0
build_older_sha_in_worktree "2-3-n-prime" "N' (v1.0.0-beta.3, APP_STORE_LEVEL=2)" "$N_PRIME_SHA" "$OUT_DIR/n-prime" "$OUT_DIR/n-prime-build.log" || N_PRIME_BUILD_RC=$?

PRE_N_PRIME_BUILD_RC=0
build_older_sha_in_worktree "3-3-pre-n-prime" "pre-N' (v0.11.0-dev.6, pre-G5-04g)" "$PRE_N_PRIME_SHA" "$OUT_DIR/pre-n-prime" "$OUT_DIR/pre-n-prime-build.log" || PRE_N_PRIME_BUILD_RC=$?

MAIN_CLEAN_RC=0
assert_main_checkout_clean "before-manifest" || MAIN_CLEAN_RC=$?

node - "$REPO_ROOT" "$OUT_DIR" "$ORIG_HEAD_SHA" "$N_PRIME_SHA" "$PRE_N_PRIME_SHA" "$N1_VERSION" "$N1_BUILD_RC" "$N_PRIME_BUILD_RC" "$PRE_N_PRIME_BUILD_RC" "$MAIN_CLEAN_RC" <<'EOF'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { collectBuildMetadata, findLinuxArtifacts } from './tools/g7-05/lib.mjs'

const [
  repoRootArg,
  outDirArg,
  n1Sha,
  nPrimeSha,
  preNPrimeSha,
  n1Version,
  n1RcRaw,
  nPrimeRcRaw,
  preNPrimeRcRaw,
  mainCleanRcRaw,
] = process.argv.slice(2)

const repoRoot = resolve(repoRootArg)
const outDir = resolve(outDirArg)
const n1Rc = Number(n1RcRaw)
const nPrimeRc = Number(nPrimeRcRaw)
const preNPrimeRc = Number(preNPrimeRcRaw)
const mainCleanRc = Number(mainCleanRcRaw)

const baseMeta = collectBuildMetadata(repoRoot)
const nPrimeArtifacts = findLinuxArtifacts(join(outDir, 'n-prime'))
const n1Artifacts = findLinuxArtifacts(join(outDir, 'n1'))
const preNPrimeArtifacts = findLinuxArtifacts(join(outDir, 'pre-n-prime'))

const builds = {
  nPrime: {
    role: "N' (v1.0.0-beta.3)",
    forkSha: nPrimeSha,
    tag: 'v1.0.0-beta.3',
    appVersion: '1.0.0',
    storeSchema: 2,
    appStoreLevel: 2,
    buildExitCode: nPrimeRc,
    logPath: join(outDir, 'n-prime-build.log'),
    deb: nPrimeArtifacts.deb,
    appImage: nPrimeArtifacts.appImage,
    ...(nPrimeArtifacts.rpm ? { rpm: nPrimeArtifacts.rpm } : {}),
  },
  n1: {
    role: 'N+1 (synthetic store-level 3 test build)',
    forkSha: n1Sha,
    baseCommitSha: n1Sha,
    patchScript: 'tools/g7-05/apply-n1-patch.mjs',
    appVersion: n1Version,
    storeSchema: 2,
    appStoreLevel: 3,
    buildExitCode: n1Rc,
    logPath: join(outDir, 'n1-build.log'),
    deb: n1Artifacts.deb,
    appImage: n1Artifacts.appImage,
    ...(n1Artifacts.rpm ? { rpm: n1Artifacts.rpm } : {}),
  },
  preNPrime: {
    role: "pre-N' (pre-G5-04g store-level guard)",
    forkSha: preNPrimeSha,
    tag: 'v0.11.0-dev.6',
    appVersion: '0.11.0',
    storeSchema: 1,
    appStoreLevel: null,
    buildExitCode: preNPrimeRc,
    logPath: join(outDir, 'pre-n-prime-build.log'),
    deb: preNPrimeArtifacts.deb,
    appImage: preNPrimeArtifacts.appImage,
    ...(preNPrimeArtifacts.rpm ? { rpm: preNPrimeArtifacts.rpm } : {}),
  },
}

console.log('=== G7-05 Upgrade/Rollback Matrix Build Summary ===')
for (const [key, b] of Object.entries(builds)) {
  console.log(`\n[${key}] ${b.role}`)
  console.log(`  SHA:            ${b.forkSha}`)
  console.log(`  Tag / Base:     ${b.tag || `HEAD (${b.baseCommitSha}) + ${b.patchScript}`}`)
  console.log(`  App Version:    ${b.appVersion}`)
  console.log(`  Store Schema:   ${b.storeSchema} (APP_STORE_LEVEL=${b.appStoreLevel ?? 'null'})`)
  console.log(`  Build Exit:     ${b.buildExitCode}`)
  for (const kind of ['deb', 'appImage', 'rpm']) {
    const art = b[kind]
    if (art) {
      console.log(`  ${kind}:`)
      console.log(`    name:         ${art.name}`)
      console.log(`    path:         ${art.path}`)
      console.log(`    bytes:        ${art.bytes} (${art.mib} MiB)`)
      console.log(`    sha256:       ${art.sha256}`)
    } else if (kind !== 'rpm') {
      console.log(`  ${kind}:         MISSING`)
    }
  }
}

const errors = []
if (builds.n1.buildExitCode !== 0 || !builds.n1.deb || !builds.n1.appImage) {
  errors.push({
    key: 'n1',
    role: builds.n1.role,
    sha: builds.n1.forkSha,
    exitCode: builds.n1.buildExitCode,
    missing: [
      ...(!builds.n1.deb ? ['deb'] : []),
      ...(!builds.n1.appImage ? ['appImage'] : []),
    ],
    logPath: builds.n1.logPath,
  })
}
if (builds.nPrime.buildExitCode !== 0 || !builds.nPrime.deb || !builds.nPrime.appImage) {
  errors.push({
    key: 'nPrime',
    role: builds.nPrime.role,
    sha: builds.nPrime.forkSha,
    exitCode: builds.nPrime.buildExitCode,
    missing: [
      ...(!builds.nPrime.deb ? ['deb'] : []),
      ...(!builds.nPrime.appImage ? ['appImage'] : []),
    ],
    logPath: builds.nPrime.logPath,
  })
}
if (builds.preNPrime.buildExitCode !== 0 || !builds.preNPrime.deb || !builds.preNPrime.appImage) {
  errors.push({
    key: 'preNPrime',
    role: builds.preNPrime.role,
    sha: builds.preNPrime.forkSha,
    exitCode: builds.preNPrime.buildExitCode,
    missing: [
      ...(!builds.preNPrime.deb ? ['deb'] : []),
      ...(!builds.preNPrime.appImage ? ['appImage'] : []),
    ],
    logPath: builds.preNPrime.logPath,
  })
}
if (mainCleanRc !== 0) {
  errors.push({
    key: 'mainCheckoutClean',
    role: 'Main checkout git status --porcelain verification',
    sha: n1Sha,
    exitCode: mainCleanRc,
    missing: [],
    logPath: '',
  })
}

const manifestPath = join(outDir, 'upgrade-matrix-artifacts.json')

if (errors.length > 0) {
  rmSync(manifestPath, { force: true })
  console.error('\n=== G7-05 Upgrade/Rollback Matrix Build ERRORS ===')
  for (const err of errors) {
    console.error(
      `ERROR [${err.key}] ${err.role} (sha=${err.sha}): buildExitCode=${err.exitCode}, missing=[${err.missing.join(', ')}]`,
    )
    if (existsSync(err.logPath)) {
      const lines = readFileSync(err.logPath, 'utf8').trim().split('\n')
      const tail = lines.slice(-40).join('\n')
      console.error(`--- Last ${Math.min(40, lines.length)} lines of ${err.logPath} ---`)
      console.error(tail)
      console.error('--- End of build log tail ---')
    }
  }
  console.log('G7_05_UPGRADE_MATRIX_BUILD_EXIT=1')
  process.exit(1)
}

const manifest = {
  collectedAt: new Date().toISOString(),
  serverVersion: baseMeta.serverVersion,
  builds,
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`\nManifest path: ${manifestPath}`)
console.log('G7_05_UPGRADE_MATRIX_BUILD_JSON_BEGIN')
console.log(JSON.stringify(manifest, null, 2))
console.log('G7_05_UPGRADE_MATRIX_BUILD_JSON_END')
console.log('G7_05_UPGRADE_MATRIX_BUILD_EXIT=0')
EOF
