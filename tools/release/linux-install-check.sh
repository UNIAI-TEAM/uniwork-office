#!/usr/bin/env bash
# Installs a UniWork Office deb on this (Debian / Ubuntu) machine, checks what
# the package set up, and removes it again:
#
#   tools/release/linux-install-check.sh <path to .deb> [--smoke]
#
# - the launcher link /usr/bin/uniwork-office and a valid desktop entry
# - the desktop entry handles uniwork://, uniwork-office:// and
#   uniwork-office-dev:// (xdg-mime), which the sign-in callback needs
# - an organization deployment profile in resources/ survives a reinstall
#   (the upgrade path) and is deleted on uninstall
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
profile="$install_dir/resources/deployment-profile.json"

fail() {
  echo "::error::$*" >&2
  exit 1
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

echo "== deployment profile kept across a reinstall"
printf '{"deploymentId":"check","apiOrigin":"https://uniwork.example","channel":"dev"}\n' \
  | sudo tee "$profile" >/dev/null
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --reinstall "$deb"
[ -f "$profile" ] || fail 'the deployment profile did not survive the reinstall'
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
[ ! -e "$profile" ] || fail 'the deployment profile is left behind'
[ ! -e "$install_dir" ] || fail "$install_dir is left behind: $(ls -A "$install_dir")"
echo "linux-install-check: ok"
