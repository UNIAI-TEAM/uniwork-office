#!/usr/bin/env bash
# Mirrors one UniWork Office release to the download bucket behind
# https://uniworkos.com/downloads/office/ and updates the signed apt repository
# there. Run by the mirror job of .github/workflows/release-installers.yml; see
# "Download server and apt repository" in tools/release/README.md.
#
#   tools/release/apt-repo.sh --dir <release files> --channel dev|beta|stable \
#     --version <version> --git-sha <40 hex> [--tag v<version>] [--notes-file <md>] \
#     [--keep N] [--base-url https://uniworkos.com/downloads/office] [--dry-run]
#
# <release files> is the merged installers-* artifacts: the deb, the AppImage,
# the exe, the dmgs, the update feed yml (<channel>.yml, <channel>-linux.yml;
# latest*.yml on stable) and SHA256SUMS-*.txt.
#
# Object keys (bucket root; the edge maps /downloads/office/* to the bucket):
#   apt/key.gpg, apt/key.asc                         the signing key (binary, armored)
#   apt/pool/main/u/uniwork-office/<deb>             the debs every index names
#   apt/dists/<channel>/main/binary-amd64/Packages{,.gz,.xz} + by-hash/SHA256/<hash>
#   apt/dists/<channel>/{Release,Release.gpg,InRelease}
#   <channel>/<version>/<release files> + SHA256SUMS
#   update/<channel>/<files the feed yml name>, then the feed yml
#   releases.json                                    public manifest, schema 1 (release-manifest.mjs)
#
# Stateless: the suite's current Packages is the manifest. The new deb's stanza
# replaces one of the same version, the newest --keep versions stay. Uploads go
# in an order that never lets a client see an index naming a missing file
# (installers, pool, by-hash + Packages, Release files, feed files, feed yml,
# releases.json), then prune removes what neither the new indexes and manifest
# nor the previous ones name (one run of grace for clients holding the
# previous index or manifest).
#
# Env: OFFICE_S3_ENDPOINT, OFFICE_S3_BUCKET, OFFICE_S3_ACCESS_KEY_ID,
# OFFICE_S3_SECRET_ACCESS_KEY, OFFICE_S3_REGION (optional, default hn-2),
# APT_GPG_PRIVATE_KEY (armored), APT_GPG_PASSPHRASE. Secrets reach only the
# processes that need them, through the environment or a file descriptor.
# Test hooks: APT_REPO_TARGET_DIR=<dir> writes the same keys as files instead
# of S3; APT_REPO_EXPECT_FPR replaces the expected key fingerprint (refused on
# GitHub Actions).
set -euo pipefail

readonly RELEASE_FPR=58A902322C8D45C433B525F51198D10926F34831
readonly PACKAGE=uniwork-office
readonly POOL=pool/main/u/uniwork-office
readonly NO_CACHE='no-cache'
# Characters every name in a key may have (release files, versions, hashes).
readonly SAFE_NAME='^[A-Za-z0-9][A-Za-z0-9._+~-]*$'

usage() {
  sed -n '7,9p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

die() {
  echo "apt-repo: $*" >&2
  exit 1
}

log() {
  echo "apt-repo: $*"
}

dir=''
channel=''
version=''
keep=5
tag=''
git_sha=''
notes_file=''
base_url=https://uniworkos.com/downloads/office
dry_run=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir) dir="${2:-}"; shift 2 ;;
    --channel) channel="${2:-}"; shift 2 ;;
    --version) version="${2:-}"; shift 2 ;;
    --keep) keep="${2:-}"; shift 2 ;;
    --tag) tag="${2:-}"; shift 2 ;;
    --git-sha) git_sha="${2:-}"; shift 2 ;;
    --notes-file) notes_file="${2:-}"; shift 2 ;;
    --base-url) base_url="${2:-}"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    -h | --help) usage ;;
    *) die "unknown argument: $1" ;;
  esac
done

case "$channel" in
  dev | beta | stable) ;;
  *) die "--channel must be dev, beta or stable" ;;
esac
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]] || die "--version must look like 0.11.0-dev.1"
[[ "$keep" =~ ^[1-9][0-9]*$ ]] || die "--keep must be a positive number"
tag="${tag:-v$version}"
[ "$tag" = "v$version" ] || die "--tag must be v$version"
[[ "$git_sha" =~ ^[0-9a-f]{40}$ ]] || die "--git-sha must be the 40-hex commit of the build"
if [ -n "$notes_file" ] && [ ! -f "$notes_file" ]; then die "--notes-file $notes_file does not exist"; fi
if [ -z "$dir" ] || [ ! -d "$dir" ]; then die "--dir must name the directory holding the release files"; fi

expect_fpr="$RELEASE_FPR"
if [ -n "${APT_REPO_EXPECT_FPR:-}" ]; then
  [ "${GITHUB_ACTIONS:-}" != true ] || die "APT_REPO_EXPECT_FPR is a test hook and refused on GitHub Actions"
  expect_fpr="$APT_REPO_EXPECT_FPR"
  log "test key fingerprint expected: $expect_fpr"
fi

target_dir="${APT_REPO_TARGET_DIR:-}"
backend=s3
if [ -n "$target_dir" ]; then
  backend=dir
  mkdir -p "$target_dir"
  target_dir="$(cd "$target_dir" && pwd)"
elif ! $dry_run; then
  for name in OFFICE_S3_ENDPOINT OFFICE_S3_BUCKET OFFICE_S3_ACCESS_KEY_ID OFFICE_S3_SECRET_ACCESS_KEY; do
    [ -n "${!name:-}" ] || die "$name is not set"
  done
fi
if $dry_run && [ "$backend" = s3 ] && [ -z "${OFFICE_S3_BUCKET:-}" ]; then
  backend=none
fi
if ! $dry_run; then
  for name in APT_GPG_PRIVATE_KEY APT_GPG_PASSPHRASE; do
    [ -n "${!name:-}" ] || die "$name is not set"
  done
fi
for tool in apt-ftparchive dpkg dpkg-deb gpg gzip xz sha256sum node; do
  command -v "$tool" >/dev/null || die "$tool is missing (apt-utils provides apt-ftparchive)"
done
if [ "$backend" = s3 ]; then
  command -v aws >/dev/null || die "aws (AWS CLI v2) is missing"
fi

manifest_tool="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-manifest.mjs"
[ -f "$manifest_tool" ] || die "release-manifest.mjs is missing next to the script"

work="$(mktemp -d)"
cleanup() {
  if [ -d "$work/gnupg" ]; then
    GNUPGHOME="$work/gnupg" gpgconf --kill all >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

# --- storage backend ------------------------------------------------------

aws_config="$work/aws-config"
printf '[default]\ns3 =\n    addressing_style = path\n' >"$aws_config"

# The endpoint and the credentials go to the aws process only, as environment.
aws_cli() {
  AWS_ENDPOINT_URL="${OFFICE_S3_ENDPOINT:-}" \
    AWS_ACCESS_KEY_ID="${OFFICE_S3_ACCESS_KEY_ID:-}" \
    AWS_SECRET_ACCESS_KEY="${OFFICE_S3_SECRET_ACCESS_KEY:-}" \
    AWS_DEFAULT_REGION="${OFFICE_S3_REGION:-hn-2}" \
    AWS_CONFIG_FILE="$aws_config" \
    AWS_SHARED_CREDENTIALS_FILE=/dev/null \
    AWS_EC2_METADATA_DISABLED=true \
    AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
    AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    AWS_PAGER='' \
    aws "$@"
}

# put <local file> <key> [cache-control] [content-type]
put() {
  local src="$1" key="$2" cache="${3:-}" type="${4:-}"
  if $dry_run; then
    echo "PUT $key${cache:+ (Cache-Control: $cache)}${type:+ (Content-Type: $type)}"
    return
  fi
  case "$backend" in
    dir)
      mkdir -p "$(dirname "$target_dir/$key")"
      cp "$src" "$target_dir/$key.part"
      mv -f "$target_dir/$key.part" "$target_dir/$key"
      ;;
    s3)
      local args=(--only-show-errors --no-progress)
      if [ -n "$cache" ]; then args+=(--cache-control "$cache"); fi
      if [ -n "$type" ]; then args+=(--content-type "$type"); fi
      aws_cli s3 cp "${args[@]}" "$src" "s3://$OFFICE_S3_BUCKET/$key"
      ;;
  esac
}

# get <key> <local file>: 0 = downloaded, 1 = the object does not exist
get() {
  local key="$1" dest="$2"
  case "$backend" in
    none) return 1 ;;
    dir)
      [ -f "$target_dir/$key" ] || return 1
      cp "$target_dir/$key" "$dest"
      ;;
    s3)
      if ! aws_cli s3 cp --only-show-errors --no-progress "s3://$OFFICE_S3_BUCKET/$key" "$dest" 2>"$work/get.err"; then
        if grep -Eq '\(404\)|NoSuchKey|Not Found|does not exist' "$work/get.err"; then
          return 1
        fi
        cat "$work/get.err" >&2
        die "could not read $key"
      fi
      ;;
  esac
}

remove() {
  local key="$1"
  if $dry_run; then
    echo "DELETE $key"
    return
  fi
  case "$backend" in
    dir) rm -f "$target_dir/$key" ;;
    s3) aws_cli s3 rm --only-show-errors "s3://$OFFICE_S3_BUCKET/$key" ;;
  esac
}

# list <prefix ending in />: the keys below it, one per line
list() {
  local prefix="$1"
  case "$backend" in
    none) ;;
    dir)
      if [ -d "$target_dir/$prefix" ]; then
        (cd "$target_dir" && find "$prefix" -type f ! -name '*.part' | sort)
      fi
      ;;
    s3)
      aws_cli s3api list-objects-v2 --bucket "$OFFICE_S3_BUCKET" --prefix "$prefix" \
        --query 'Contents[].Key' --output text | tr '\t' '\n' | grep -v '^None$' | sort || true
      ;;
  esac
}

# --- version helpers ------------------------------------------------------

# Reads "<version><TAB><rest>" lines, prints them newest version first.
sort_by_version_desc() {
  local lines=() line i j
  while IFS= read -r line; do
    [ -n "$line" ] && lines+=("$line")
  done
  for ((i = 1; i < ${#lines[@]}; i++)); do
    line="${lines[i]}"
    j=$((i - 1))
    while [ "$j" -ge 0 ] && dpkg --compare-versions "${lines[j]%%$'\t'*}" lt "${line%%$'\t'*}"; do
      lines[j + 1]="${lines[j]}"
      j=$((j - 1))
    done
    lines[j + 1]="$line"
  done
  if [ "${#lines[@]}" -gt 0 ]; then printf '%s\n' "${lines[@]}"; fi
}

# The pool file names (basename of Filename:) an index names.
pool_names_of() {
  sed -n 's|^Filename: *||p' "$1" | sed 's|.*/||'
}

# The SHA256 hashes a Release file lists.
release_hashes_of() {
  awk '/^SHA256:/ { on = 1; next } /^[^ ]/ { on = 0 } on && NF == 3 { print $1 }' "$1"
}

# The file names an electron-builder feed yml names (files[].url and path).
feed_names_of() {
  sed -nE 's/^[[:space:]]*(-[[:space:]]+)?(url|path):[[:space:]]*//p' "$1" | tr -d "\"'\r" | sort -u
}

# --- the release files ----------------------------------------------------

dir="$(cd "$dir" && pwd)"
release_files=()
for path in "$dir"/*; do
  [ -f "$path" ] || continue
  name="${path##*/}"
  [ "$name" = SHA256SUMS ] && continue
  [[ "$name" =~ $SAFE_NAME ]] || die "release file name not allowed: $name"
  release_files+=("$name")
done
[ "${#release_files[@]}" -gt 0 ] || die "no release files in $dir"

debs=()
for name in "${release_files[@]}"; do
  case "$name" in *.deb) debs+=("$name") ;; esac
done
[ "${#debs[@]}" = 1 ] || die "expected one deb in $dir, found ${#debs[@]}"
deb="$dir/${debs[0]}"
deb_package="$(dpkg-deb -f "$deb" Package)"
deb_version="$(dpkg-deb -f "$deb" Version)"
deb_arch="$(dpkg-deb -f "$deb" Architecture)"
[ "$deb_package" = "$PACKAGE" ] || die "the deb is package $deb_package, expected $PACKAGE"
[ "$deb_arch" = amd64 ] || die "the deb is for $deb_arch, expected amd64"
[ "$deb_version" = "$version" ] || die "the deb is version $deb_version, expected $version"
pool_name="${PACKAGE}_${deb_version#*:}_amd64.deb"
[[ "$pool_name" =~ $SAFE_NAME ]] || die "pool file name not allowed: $pool_name"

feeds=()
for name in "${release_files[@]}"; do
  case "$name" in *.yml) feeds+=("$name") ;; esac
done
[ "${#feeds[@]}" -gt 0 ] || die "no update feed yml in $dir"
feed_files=()
for feed in "${feeds[@]}"; do
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    [[ "$name" =~ $SAFE_NAME ]] || die "$feed names a file not allowed: $name"
    [ -f "$dir/$name" ] || die "$feed names $name, which is not in $dir"
    feed_files+=("$name")
  done < <(feed_names_of "$dir/$feed")
done
mapfile -t feed_files < <(printf '%s\n' "${feed_files[@]}" | sort -u | grep -v '^$' || true)

dists="apt/dists/$channel"
bin="$dists/main/binary-amd64"
mode=''
if $dry_run; then mode=', dry run'; fi
log "channel $channel, version $version, keep $keep, backend $backend$mode"

# --- the new index --------------------------------------------------------

mkdir -p "$work/prev" "$work/stanzas" "$work/repo/$POOL" "$work/dists/main/binary-amd64"
prev_packages="$work/prev/Packages"
if get "$bin/Packages" "$prev_packages"; then
  log "previous index: $(grep -c '^Package:' "$prev_packages" || true) package(s)"
else
  : >"$prev_packages"
  log "no previous index, first run of suite $channel"
fi
prev_release="$work/prev/Release"
get "$dists/Release" "$prev_release" || : >"$prev_release"
mkdir -p "$work/prev/feed"
while IFS= read -r key; do
  name="${key##*/}"
  case "$name" in *.yml) ;; *) continue ;; esac
  [[ "$name" =~ $SAFE_NAME ]] || continue
  get "$key" "$work/prev/feed/$name" || true
done < <(list "update/$channel/")
get releases.json "$work/prev/releases.json" || : >"$work/prev/releases.json"
node "$manifest_tool" versions --previous "$work/prev/releases.json" --channel "$channel" >"$work/prev/versions"

# Installers: the newest --keep version directories (always this one) stay
# and are what the manifest lists.
mapfile -t channel_keys < <(list "$channel/")
{
  printf '%s\t-\n' "$version"
  for key in "${channel_keys[@]}"; do
    rest="${key#"$channel"/}"
    if [[ "$rest" == */* ]]; then printf '%s\t-\n' "${rest%%/*}"; fi
  done
} | sort -u | sort_by_version_desc | cut -f1 | head -n "$keep" >"$work/keep-versions"
grep -qxF "$version" "$work/keep-versions" || echo "$version" >>"$work/keep-versions"

cp "$deb" "$work/repo/$POOL/$pool_name"
(cd "$work/repo" && apt-ftparchive packages "$POOL") >"$work/new.stanza"
grep -q "^Filename: $POOL/$pool_name\$" "$work/new.stanza" || die "apt-ftparchive wrote no stanza for $pool_name"

# One file per stanza: the previous ones (other versions only), then the new one.
awk -v dir="$work/stanzas" 'BEGIN { RS = "" } { f = sprintf("%s/prev-%05d", dir, NR); print > f; close(f) }' "$prev_packages"
cp "$work/new.stanza" "$work/stanzas/new"
entries=()
for stanza in "$work/stanzas"/*; do
  [ -s "$stanza" ] || continue
  stanza_package="$(sed -n 's/^Package: *//p' "$stanza")"
  stanza_version="$(sed -n 's/^Version: *//p' "$stanza")"
  [ "$stanza_package" = "$PACKAGE" ] || continue
  if [ "${stanza##*/}" != new ] && [ "$stanza_version" = "$deb_version" ]; then continue; fi
  entries+=("$stanza_version"$'\t'"$stanza")
done
: >"$work/dists/main/binary-amd64/Packages"
count=0
while IFS=$'\t' read -r _ stanza; do
  [ "$count" -lt "$keep" ] || break
  if [ "$count" -gt 0 ]; then echo >>"$work/dists/main/binary-amd64/Packages"; fi
  sed '/^$/d' "$stanza" >>"$work/dists/main/binary-amd64/Packages"
  count=$((count + 1))
done < <(printf '%s\n' "${entries[@]}" | sort_by_version_desc)
log "new index: $count version(s): $(sed -n 's/^Version: *//p' "$work/dists/main/binary-amd64/Packages" | tr '\n' ' ')"

(
  cd "$work/dists/main/binary-amd64"
  gzip -9nc Packages >Packages.gz
  xz -9c Packages >Packages.xz
)
(
  cd "$work/dists"
  # SHA256 only: apt fetches by-hash with the strongest hash Release lists,
  # and only by-hash/SHA256 is published
  apt-ftparchive \
    -o APT::FTPArchive::Release::MD5=false \
    -o APT::FTPArchive::Release::SHA1=false \
    -o APT::FTPArchive::Release::SHA512=false \
    -o APT::FTPArchive::Release::Origin=UniWork \
    -o "APT::FTPArchive::Release::Label=UniWork Office" \
    -o "APT::FTPArchive::Release::Suite=$channel" \
    -o "APT::FTPArchive::Release::Codename=$channel" \
    -o APT::FTPArchive::Release::Architectures=amd64 \
    -o APT::FTPArchive::Release::Components=main \
    -o "APT::FTPArchive::Release::Description=UniWork Office $channel" \
    release . >"$work/Release.body"
)
# apt-ftparchive writes no Acquire-By-Hash field for the release command alone.
{
  sed -n '1,/^Date:/p' "$work/Release.body"
  echo 'Acquire-By-Hash: yes'
  sed '1,/^Date:/d' "$work/Release.body"
} >"$work/dists/Release"
if grep -q '^Valid-Until:' "$work/dists/Release"; then die "Release must not carry Valid-Until"; fi

# --- signing (before anything is uploaded) ---------------------------------

if $dry_run; then
  log "dry run: the key is not imported, nothing is signed or uploaded"
else
  export GNUPGHOME="$work/gnupg"
  mkdir -m 700 "$GNUPGHOME"
  gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --import \
    3<<<"$APT_GPG_PASSPHRASE" <<<"$APT_GPG_PRIVATE_KEY" 2>"$work/import.log" ||
    die "the signing key could not be imported (APT_GPG_PRIVATE_KEY / APT_GPG_PASSPHRASE)"
  mapfile -t primaries < <(gpg --batch --with-colons --list-secret-keys |
    awk -F: '$1 == "sec" { want = 1; next } want && $1 == "fpr" { print $10; want = 0 }')
  [ "${#primaries[@]}" = 1 ] || die "APT_GPG_PRIVATE_KEY must hold exactly one secret key, found ${#primaries[@]}"
  [ "${primaries[0]}" = "$expect_fpr" ] ||
    die "the signing key is ${primaries[0]}, expected $expect_fpr"
  sign() {
    gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 --local-user "$expect_fpr!" \
      --digest-algo SHA512 "$@" 3<<<"$APT_GPG_PASSPHRASE"
  }
  sign --clearsign -o "$work/dists/InRelease" "$work/dists/Release" 2>"$work/sign.log" ||
    die "signing InRelease failed (wrong APT_GPG_PASSPHRASE?)"
  sign --armor --detach-sign -o "$work/dists/Release.gpg" "$work/dists/Release" 2>>"$work/sign.log" ||
    die "signing Release.gpg failed"
  gpg --batch --export "$expect_fpr" >"$work/key.gpg"
  gpg --batch --armor --export "$expect_fpr" >"$work/key.asc"
  unset -f sign
  unset APT_GPG_PRIVATE_KEY APT_GPG_PASSPHRASE
  log "signed with $expect_fpr"
fi

(cd "$dir" && sha256sum -- "${release_files[@]}") >"$work/SHA256SUMS"
mkdir -p "$work/assets"
for name in "${release_files[@]}"; do
  ln -s "$dir/$name" "$work/assets/$name"
done
cp "$work/SHA256SUMS" "$work/assets/SHA256SUMS"
node "$manifest_tool" update --previous "$work/prev/releases.json" --dir "$work/assets" \
  --channel "$channel" --version "$version" --tag "$tag" --git-sha "$git_sha" \
  --notes-file "$notes_file" --deb-version "$deb_version" --base-url "$base_url" \
  --keep-versions "$(paste -sd, "$work/keep-versions")" >"$work/releases.json"

# --- uploads, in order ------------------------------------------------------

put "$work/key.gpg" apt/key.gpg "$NO_CACHE"
put "$work/key.asc" apt/key.asc "$NO_CACHE"

for name in "${release_files[@]}"; do
  put "$dir/$name" "$channel/$version/$name"
done
put "$work/SHA256SUMS" "$channel/$version/SHA256SUMS" "$NO_CACHE"

put "$deb" "apt/$POOL/$pool_name"

for name in Packages Packages.gz Packages.xz; do
  hash="$(sha256sum "$work/dists/main/binary-amd64/$name" | cut -d' ' -f1)"
  put "$work/dists/main/binary-amd64/$name" "$bin/by-hash/SHA256/$hash"
done
for name in Packages Packages.gz Packages.xz; do
  put "$work/dists/main/binary-amd64/$name" "$bin/$name" "$NO_CACHE"
done

put "$work/dists/Release" "$dists/Release" "$NO_CACHE"
put "$work/dists/Release.gpg" "$dists/Release.gpg" "$NO_CACHE"
put "$work/dists/InRelease" "$dists/InRelease" "$NO_CACHE"

for name in "${feed_files[@]}"; do
  put "$dir/$name" "update/$channel/$name"
done
for feed in "${feeds[@]}"; do
  put "$dir/$feed" "update/$channel/$feed" "$NO_CACHE"
done

put "$work/releases.json" releases.json "$NO_CACHE" 'application/json; charset=utf-8'

# --- prune -------------------------------------------------------------------

# Pool: keep what any suite's current index or this suite's previous index names.
{
  pool_names_of "$work/dists/main/binary-amd64/Packages"
  pool_names_of "$prev_packages"
  for other in dev beta stable; do
    [ "$other" = "$channel" ] && continue
    if get "apt/dists/$other/main/binary-amd64/Packages" "$work/other-$other"; then
      pool_names_of "$work/other-$other"
    fi
  done
} | sort -u >"$work/keep-pool"
while IFS= read -r key; do
  grep -qxF "${key##*/}" "$work/keep-pool" || remove "$key"
done < <(list "apt/$POOL/")

# by-hash: keep the files the new and the previous Release name.
{
  release_hashes_of "$work/dists/Release"
  release_hashes_of "$prev_release"
} | sort -u >"$work/keep-hash"
while IFS= read -r key; do
  grep -qxF "${key##*/}" "$work/keep-hash" || remove "$key"
done < <(list "$bin/by-hash/SHA256/")

# Feed: keep the files the new and the previous feed yml name.
{
  printf '%s\n' "${feeds[@]}" "${feed_files[@]}"
  for feed in "$work/prev/feed"/*.yml; do
    [ -f "$feed" ] || continue
    echo "${feed##*/}"
    feed_names_of "$feed"
  done
} | sort -u >"$work/keep-feed"
while IFS= read -r key; do
  grep -qxF "${key##*/}" "$work/keep-feed" || remove "$key"
done < <(list "update/$channel/")

# Installers: keep the kept versions and what the previous manifest listed.
cat "$work/keep-versions" "$work/prev/versions" | sort -u >"$work/keep-dirs"
for key in "${channel_keys[@]}"; do
  rest="${key#"$channel"/}"
  [[ "$rest" == */* ]] || continue
  grep -qxF "${rest%%/*}" "$work/keep-dirs" || remove "$key"
done

log "done: $channel $version"
