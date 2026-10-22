#!/bin/sh
# Installs UniWork Office on Debian and Ubuntu from the signed apt repository:
# adds the repository key and source, then runs apt-get update and install.
# Published by tools/release/apt-repo.sh at
# https://uniworkos.com/downloads/office/install.sh; see "Install script" in
# tools/release/README.md.
#
#   curl -fsSL https://uniworkos.com/downloads/office/install.sh | sudo sh
#   curl -fsSL https://uniworkos.com/downloads/office/install.sh | sudo sh -s -- dev|beta|stable
#
# The channel defaults to stable. No repository key or source is written until
# the platform, the channel and the key fingerprint have been checked (gpg
# itself may be installed first through apt). The key and the source are
# the files the deb's postinst writes (same bytes), so a later deb upgrade or
# purge treats them as its own and the two never fight. Re-running changes
# nothing. A source file at the same path that does not start with the
# "# managed by uniwork-office" line is the admin's own and is left alone.
#
# Test hook: UNIWORK_OFFICE_REPO_URL replaces the download base URL (the
# MinIO check of tools/release/apt-repo-minio-check.sh points it at a local
# server). Leave it unset.
#
# Everything runs inside main, called on the last line: a cut-off download
# parses as an unfinished function and executes nothing.
set -eu

main() {
  release_fpr=58A902322C8D45C433B525F51198D10926F34831
  keyring=/usr/share/keyrings/uniwork-office-archive-keyring.gpg
  sources=/etc/apt/sources.list.d/uniwork-office.sources
  managed_line='# managed by uniwork-office'
  base="${UNIWORK_OFFICE_REPO_URL:-https://uniworkos.com/downloads/office}"
  repo="$base/apt"

  if [ "$#" -gt 1 ]; then usage; fi
  channel="${1:-stable}"
  case "$channel" in
    dev | beta | stable) ;;
    *) usage ;;
  esac

  if [ "$(id -u)" != 0 ]; then
    die "this installs a package, run it with sudo"
  fi

  os_ids=''
  if [ -r /etc/os-release ]; then
    os_ids="$(
      # shellcheck disable=SC1091
      . /etc/os-release
      echo "${ID:-} ${ID_LIKE:-}"
    )"
  fi
  case " $os_ids " in
    *" debian "* | *" ubuntu "*) ;;
    *) die "this script supports Debian and Ubuntu only (found: ${os_ids:-unknown})" ;;
  esac
  arch="$(dpkg --print-architecture 2>/dev/null || true)"
  if [ "$arch" != amd64 ]; then
    die "UniWork Office is built for amd64 only (this machine: ${arch:-unknown})"
  fi

  if command -v curl >/dev/null 2>&1; then
    downloader=curl
  elif command -v wget >/dev/null 2>&1; then
    downloader=wget
  else
    die "neither curl nor wget is installed; install one of them and run this again"
  fi

  tmp="$(mktemp -d)"
  trap 'cleanup' EXIT
  trap 'exit 1' HUP INT TERM

  say "checking channel $channel"
  if ! fetch "$repo/dists/$channel/InRelease" "$tmp/InRelease"; then
    die "channel $channel is not published yet; try: curl -fsSL $base/install.sh | sudo sh -s -- dev"
  fi
  if ! fetch "$repo/key.gpg" "$tmp/key.gpg"; then
    die "could not download the repository key from $repo/key.gpg"
  fi

  if ! command -v gpg >/dev/null 2>&1; then
    say "installing gpg to check the repository key"
    DEBIAN_FRONTEND=noninteractive apt-get update -q </dev/null
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q gpg </dev/null
  fi
  mkdir -m 700 "$tmp/gnupg"
  found_fpr="$(
    GNUPGHOME="$tmp/gnupg" gpg --batch --show-keys --with-colons "$tmp/key.gpg" </dev/null 2>/dev/null |
      awk -F: '$1 == "pub" { n++; want = 1; next } want && $1 == "fpr" { f = $10; want = 0 } END { if (n == 1) print f }'
  )"
  if [ "$found_fpr" != "$release_fpr" ]; then
    die "the repository key is ${found_fpr:-unreadable or not a single key}, expected exactly one key $release_fpr; nothing was changed"
  fi
  say "repository key $release_fpr verified"

  # the same text apps/shell/electron-builder.cjs (aptSourcesText) puts in the deb
  {
    printf '%s\n' "$managed_line"
    printf 'Types: deb\n'
    printf 'URIs: %s\n' "$repo"
    printf 'Suites: %s\n' "$channel"
    printf 'Components: main\n'
    printf 'Architectures: amd64\n'
    printf 'Signed-By: %s\n' "$keyring"
  } >"$tmp/uniwork-office.sources"

  if [ -e "$sources" ] && [ "$(head -n 1 "$sources" 2>/dev/null || true)" != "$managed_line" ]; then
    say "$sources is not managed by UniWork Office, left as is; apt will use it"
  else
    put_file "$tmp/key.gpg" "$keyring"
    put_file "$tmp/uniwork-office.sources" "$sources"
  fi

  say "installing uniwork-office from channel $channel"
  DEBIAN_FRONTEND=noninteractive apt-get update -q </dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q uniwork-office </dev/null
  say "done: UniWork Office is installed; later builds arrive with apt upgrade"
}

usage() {
  echo "usage: curl -fsSL https://uniworkos.com/downloads/office/install.sh | sudo sh -s -- [dev|beta|stable]" >&2
  echo "       the channel defaults to stable" >&2
  exit 2
}

die() {
  echo "uniwork-office install: $*" >&2
  exit 1
}

say() {
  echo "uniwork-office install: $*"
}

cleanup() {
  if [ -n "${tmp:-}" ] && [ -d "$tmp" ]; then
    GNUPGHOME="$tmp/gnupg" gpgconf --kill all >/dev/null 2>&1 || true
    rm -rf "$tmp"
  fi
}

# fetch <url> <file>: 0 = downloaded
fetch() {
  case "$downloader" in
    curl) curl -fsSL -o "$2" "$1" </dev/null ;;
    wget) wget -q -O "$2" "$1" </dev/null ;;
  esac
}

# put_file <new content> <target>: 0644, written only when the content differs
put_file() {
  if [ -f "$2" ] && cmp -s "$1" "$2"; then
    say "$2 is up to date"
    return
  fi
  install -D -m 0644 "$1" "$2"
  say "wrote $2"
}

main "$@"
