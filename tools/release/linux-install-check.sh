#!/usr/bin/env bash
# Installs a UniWork Office deb on this (Debian / Ubuntu) machine, checks what
# the package set up, and removes it again:
#
#   tools/release/linux-install-check.sh <path to .deb> [--smoke]
#
# - the launcher link /usr/bin/uniwork-office and a valid desktop entry
# - the desktop entry handles uniwork://, uniwork-office:// and
#   uniwork-office-dev:// (xdg-mime), which the sign-in callback needs
# - the build deployment defaults (resources/deployment-defaults.json) are installed,
#   survive a reinstall (the upgrade path) and go on uninstall
# - release debs (those that ship resources/apt/uniwork-office.sources) register
#   the apt repository: the keyring (fingerprint) and the deb822 source for the
#   deb's channel, kept by `apt-get remove`, dropped by `apt-get purge`;
#   UNIWORK_OFFICE_APT_REPO=false in /etc/default/uniwork-office writes nothing,
#   and an admin's own source file (no managed header) is left alone
# - --smoke: launches the installed app headless (xvfb, with its sandbox) and
#   opens a new document in each of the six editors
#   (e2e/packaged-linux-smoke.spec.ts; needs npm ci and xvfb-run)
# - uninstall leaves no launcher link, desktop entry or install directory
#
# Needs sudo. Used by the release workflow (without --smoke) and for manual
# verification on a Linux VM.
set -euo pipefail

deb="${1:?usage: linux-install-check.sh <path to .deb> [--smoke]}"
smoke="${2:-}"
deb="$(realpath "$deb")"
install_dir='/opt/UniWork Office'
desktop=/usr/share/applications/uniwork-office.desktop
profile="$install_dir/resources/deployment-defaults.json"
apt_keyring=/usr/share/keyrings/uniwork-office-archive-keyring.gpg
apt_list=/etc/apt/sources.list.d/uniwork-office.sources
apt_optout=/etc/default/uniwork-office
apt_fingerprint=58A902322C8D45C433B525F51198D10926F34831

fail() {
  echo "::error::$*" >&2
  exit 1
}

# Release debs ship the channel's apt source; a local build ships none and
# writes nothing, so the apt checks below are skipped for it.
has_apt_source=false
# (grep reads to the end: -q would SIGPIPE tar and trip pipefail)
if [ "$(dpkg-deb --fsys-tarfile "$deb" | tar -tf - | grep -cx './opt/UniWork Office/resources/apt/uniwork-office.sources')" = 1 ]; then
  has_apt_source=true
fi
# Version 0.11.0-dev.1 -> channel dev
version="$(dpkg-deb -f "$deb" Version)"
channel="${version#*-}"
channel="${channel%%.*}"
expected_sources="$(printf '%s\n' \
  '# managed by uniwork-office' \
  'Types: deb' \
  'URIs: https://uniworkos.com/downloads/office/apt' \
  "Suites: $channel" \
  'Components: main' \
  'Architectures: amd64' \
  "Signed-By: $apt_keyring")"

check_apt_files_present() {
  [ -f "$apt_keyring" ] || fail "$apt_keyring is missing"
  [ -f "$apt_list" ] || fail "$apt_list is missing"
  [ "$(stat -c %a "$apt_keyring")" = 644 ] || fail "$apt_keyring is not mode 0644"
  [ "$(stat -c %a "$apt_list")" = 644 ] || fail "$apt_list is not mode 0644"
}

check_apt_files_absent() {
  [ ! -e "$apt_keyring" ] || fail "$apt_keyring is left behind"
  [ ! -e "$apt_list" ] || fail "$apt_list is left behind"
}

echo "== install $deb"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  xdg-utils desktop-file-utils "$deb"
dpkg -s uniwork-office | sed -n '1,12p'
[ "$(dpkg-query -W -f '${Package}' uniwork-office)" = uniwork-office ] || fail 'Package is not uniwork-office'

echo "== launcher and desktop entry"
[ -x /usr/bin/uniwork-office ] || fail '/usr/bin/uniwork-office is missing'
[ "$(readlink -f /usr/bin/uniwork-office)" = "$install_dir/uniwork-office" ] \
  || fail "/usr/bin/uniwork-office points at $(readlink -f /usr/bin/uniwork-office)"
desktop-file-validate "$desktop"
grep -E '^(Name|Exec|Icon|StartupWMClass|MimeType)=' "$desktop"
ls /usr/share/icons/hicolor/*/apps/uniwork-office.png >/dev/null || fail 'no hicolor icons'
stat -c '%a %n' "$install_dir/chrome-sandbox"

echo "== URL scheme handlers"
for scheme in uniwork uniwork-office uniwork-office-dev; do
  handler="$(xdg-mime query default "x-scheme-handler/$scheme")"
  echo "x-scheme-handler/$scheme -> $handler"
  [ "$handler" = uniwork-office.desktop ] || fail "$scheme:// is handled by '$handler'"
done

if [ "$has_apt_source" = true ]; then
  echo "== apt repository: keyring and source for the $channel channel"
  case "$channel" in dev | beta) ;; *) fail "version $version carries no dev / beta channel" ;; esac
  check_apt_files_present
  fingerprint="$(GNUPGHOME="$(mktemp -d)" gpg --show-keys --with-colons "$apt_keyring" | awk -F: '$1 == "fpr" { print $10; exit }')"
  echo "keyring fingerprint $fingerprint"
  [ "$fingerprint" = "$apt_fingerprint" ] || fail "the keyring holds $fingerprint, expected $apt_fingerprint"
  cat "$apt_list"
  [ "$(cat "$apt_list")" = "$expected_sources" ] || fail "$apt_list does not match the $channel source"
else
  echo "== apt repository: this deb ships no source (local build), skipped"
fi

echo "== deployment defaults kept across a reinstall"
[ -f "$profile" ] || fail 'the package did not install deployment-defaults.json'
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --reinstall "$deb"
[ -f "$profile" ] || fail 'the deployment defaults did not survive the reinstall'
[ -x /usr/bin/uniwork-office ] || fail 'the launcher link did not survive the reinstall'

if [ "$smoke" = --smoke ]; then
  echo "== headless smoke: six editors"
  UNIWORK_PACKAGED_APP="$install_dir/uniwork-office" xvfb-run --auto-servernum -- \
    npx playwright test --config e2e/playwright.config.ts packaged-linux-smoke
fi

echo "== uninstall"
sudo DEBIAN_FRONTEND=noninteractive apt-get remove -y uniwork-office
[ ! -e /usr/bin/uniwork-office ] || fail '/usr/bin/uniwork-office is left behind'
[ ! -e "$desktop" ] || fail "$desktop is left behind"
[ ! -e "$profile" ] || fail 'the deployment defaults are left behind'
[ ! -e "$install_dir" ] || fail "$install_dir is left behind: $(ls -A "$install_dir")"

if [ "$has_apt_source" = true ]; then
  echo "== apt remove keeps the source and keyring, purge drops them"
  check_apt_files_present
  sudo DEBIAN_FRONTEND=noninteractive apt-get purge -y uniwork-office
  check_apt_files_absent

  echo "== opt-out: UNIWORK_OFFICE_APT_REPO=false writes nothing"
  echo 'UNIWORK_OFFICE_APT_REPO=false' | sudo tee "$apt_optout" >/dev/null
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "$deb"
  check_apt_files_absent
  sudo DEBIAN_FRONTEND=noninteractive apt-get purge -y uniwork-office
  sudo rm -f "$apt_optout"

  echo "== an admin's own source file is left alone"
  printf 'Types: deb\nURIs: https://example.invalid/apt\nSuites: custom\nComponents: main\n' \
    | sudo tee "$apt_list" >/dev/null
  own_sources="$(cat "$apt_list")"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "$deb"
  [ "$(cat "$apt_list")" = "$own_sources" ] || fail "the admin's $apt_list was overwritten"
  [ ! -e "$apt_keyring" ] || fail "$apt_keyring was written next to an admin's source file"
  sudo DEBIAN_FRONTEND=noninteractive apt-get purge -y uniwork-office
  [ "$(cat "$apt_list")" = "$own_sources" ] || fail "purge removed the admin's $apt_list"
  sudo rm -f "$apt_list"
fi
echo "linux-install-check: ok"
