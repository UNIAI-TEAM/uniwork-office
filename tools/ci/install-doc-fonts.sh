#!/usr/bin/env bash
# Install the pinned document fonts behind the docs-visual pixel baselines.
#
# Usage: install-doc-fonts.sh <cache-dir> [dpkg args...]
#   <cache-dir>  holds the three .deb files; CI caches it (actions/cache), so a
#                hit means no network at all. Missing or corrupt files are
#                downloaded again.
#   DOC_FONTS_VERIFY_ONLY=1  stop after the download + sha256 check (no dpkg).
#
# Why not `apt-get install`: apt has no low-speed abort, so a slow
# azure.archive.ubuntu.com mirror held the e2e job for 16-29 min on 61 MB of
# fonts-noto-cjk. Here every transfer is bounded and falls back to a second
# mirror. The versions are the jammy (ubuntu-22.04) ones CI installed so far;
# changing any of them moves the pixel baselines.
set -euo pipefail

cache_dir=${1:?usage: install-doc-fonts.sh <cache-dir> [dpkg args...]}
shift || true

mirrors=(http://archive.ubuntu.com/ubuntu/pool http://azure.archive.ubuntu.com/ubuntu/pool)

# <pool path>|<sha256>, checked against the jammy Packages index (amd64)
debs=(
  "universe/f/fonts-crosextra-carlito/fonts-crosextra-carlito_20130920-1.1_all.deb|7385475cde807e1363c3361976576571870373032466c7f525d5900852b6f420"
  "universe/f/fonts-crosextra-caladea/fonts-crosextra-caladea_20130214-2.1_all.deb|1330d25dfa5bab2e9b712b4950d2855cdb63a2b2b9451e2ffb93618c77e1f242"
  "main/f/fonts-noto-cjk/fonts-noto-cjk_20220127+repack1-1_all.deb|e804b3474a79bd70d5f03f590e2d06dbc5ce17f48be7cfaf6c48086471edd5be"
)

sha_ok() { [ -f "$1" ] && [ "$(sha256sum "$1" | cut -d' ' -f1)" = "$2" ]; }

mkdir -p "$cache_dir"
downloads=0
files=()
for entry in "${debs[@]}"; do
  path=${entry%%|*}
  sha=${entry##*|}
  name=${path##*/}
  dest=$cache_dir/$name
  files+=("$dest")
  if sha_ok "$dest" "$sha"; then
    echo "doc-fonts: cache hit $name"
    continue
  fi
  rm -f "$dest"
  tried=()
  for m in "${mirrors[@]}"; do
    url=$m/$path
    tried+=("$url")
    echo "doc-fonts: downloading $url"
    # a stall below ~1 MB/s for 15 s aborts the attempt; the whole attempt is
    # capped at 75 s (the largest file is 61 MB), one retry per mirror
    if curl -fsSL --connect-timeout 10 --speed-limit 1000000 --speed-time 15 \
      --max-time 75 --retry 1 --retry-delay 2 -o "$dest.part" "$url" &&
      sha_ok "$dest.part" "$sha"; then
      mv "$dest.part" "$dest"
      downloads=$((downloads + 1))
      break
    fi
    echo "doc-fonts: failed $url" >&2
    rm -f "$dest.part"
  done
  if ! [ -f "$dest" ]; then
    echo "::error::doc-fonts: could not fetch a valid $name; tried: ${tried[*]}" >&2
    exit 1
  fi
done
echo "doc-fonts: $downloads downloads$([ "$downloads" -eq 0 ] && echo ', cache hit, no network')"

if [ "${DOC_FONTS_VERIFY_ONLY:-}" = 1 ]; then
  echo "doc-fonts: verify only, skipping dpkg"
  exit 0
fi
sudo dpkg -i "$@" "${files[@]}"
