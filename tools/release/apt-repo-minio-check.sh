#!/usr/bin/env bash
# Manual end-to-end check of tools/release/apt-repo.sh against a local MinIO
# and real apt clients (Ubuntu 24.04 and 22.04 containers). Not run by CI; see
# "Download server and apt repository" in tools/release/README.md.
#
#   bash tools/release/apt-repo-minio-check.sh
#
# Starts bitnamilegacy/minio on a free port with a throwaway volume, makes a
# public-read bucket, publishes two fake versions of uniwork-office with a
# throwaway test key (same env names as the mirror job), and in each client:
# runs the one-command install on a clean client (wget the apt/latest deb, apt
# install it; the fake deb's postinst writes the keyring and the deb822 source,
# like the real one, pointing at MinIO over plain http), mirrors v2 and proves
# apt update && apt upgrade installs it, then proves apt-get update refuses a
# tampered InRelease and a tampered Packages. A second set of clean amd64 clients
# (no curl, gpg: only curl + ca-certificates as client setup; on a host that is not amd64
# the clients are native and the piped copy reports amd64 for the architecture gate) runs the published
# install.sh as `curl | sh -s -- dev` with UNIWORK_OFFICE_REPO_URL at MinIO (the
# release key fingerprint in the piped copy is swapped for the test key's with
# sed): refusals first (not root, unpublished channel, a key that is not the
# expected one, each leaving nothing written), then the install (gpg installed
# by the script, keyring and source byte-equal to the deb's), a second run that
# changes nothing, an admin-owned source left alone, and apt upgrade to v2.
# Everything it started (containers, volume, temp files) is removed by id at the end.
#
# Needs docker, apt-ftparchive (apt-utils), dpkg-deb, gpg, node, curl. Without
# an aws CLI on PATH it runs amazon/aws-cli in docker.
set -euo pipefail

readonly MINIO_IMAGE=bitnamilegacy/minio:2025.7.23
readonly AWS_IMAGE=amazon/aws-cli:2.27.50
readonly CLIENTS=(ubuntu:24.04 ubuntu:22.04)
readonly CHANNEL=dev
# the key install.sh checks the repository key against; the piped copy gets the test key's instead
readonly RELEASE_FPR=58A902322C8D45C433B525F51198D10926F34831
readonly KEYRING=/usr/share/keyrings/uniwork-office-archive-keyring.gpg
readonly LIST=/etc/apt/sources.list.d/uniwork-office.sources
readonly V1=0.11.0-dev.1
readonly V2=0.11.0-dev.2
# electron-builder writes the deb Version with every '-' as '~'; apt sees this form
readonly D1=0.11.0~dev.1
readonly D2=0.11.0~dev.2
readonly GIT_SHA=0000000000000000000000000000000000000001

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for tool in docker apt-ftparchive dpkg-deb gpg node curl; do
  command -v "$tool" >/dev/null || { echo "minio-check: $tool is missing" >&2; exit 1; }
done

root="$(mktemp -d)"
containers=()
volume=''
cleanup() {
  local status=$?
  for id in "${containers[@]}"; do docker rm -f "$id" >/dev/null 2>&1 || true; done
  if [ -n "$volume" ]; then docker volume rm -f "$volume" >/dev/null 2>&1 || true; fi
  GNUPGHOME="$root/gnupg" gpgconf --kill all >/dev/null 2>&1 || true
  GNUPGHOME="$root/gnupg-other" gpgconf --kill all >/dev/null 2>&1 || true
  rm -rf "$root"
  if [ "$status" = 0 ]; then echo "minio-check: PASS"; else echo "minio-check: FAIL ($status)" >&2; fi
}
trap cleanup EXIT

step() {
  echo "minio-check: $*"
}

fail() {
  echo "minio-check: $*" >&2
  exit 1
}

free_port() {
  node -e 'const s = require("net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close() })'
}

# --- MinIO ------------------------------------------------------------------------

port="$(free_port)"
console_port="$(free_port)"
bucket=office-downloads-check
export OFFICE_S3_ENDPOINT="http://127.0.0.1:$port"
export OFFICE_S3_BUCKET="$bucket"
OFFICE_S3_ACCESS_KEY_ID="check$(od -An -N4 -tx4 /dev/urandom | tr -d ' ')"
export OFFICE_S3_ACCESS_KEY_ID
OFFICE_S3_SECRET_ACCESS_KEY="$(head -c 24 /dev/urandom | base64 | tr -d '/+=')"
export OFFICE_S3_SECRET_ACCESS_KEY
export OFFICE_S3_REGION=hn-2

volume="$(docker volume create)"
step "MinIO on 127.0.0.1:$port (volume $volume)"
MINIO_ROOT_USER="$OFFICE_S3_ACCESS_KEY_ID" MINIO_ROOT_PASSWORD="$OFFICE_S3_SECRET_ACCESS_KEY" \
  docker run -d --network host -v "$volume:/bitnami/minio/data" \
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD \
  -e MINIO_API_PORT_NUMBER="$port" -e MINIO_CONSOLE_PORT_NUMBER="$console_port" \
  -e MINIO_DEFAULT_BUCKETS="$bucket" "$MINIO_IMAGE" >"$root/minio.id"
containers+=("$(cat "$root/minio.id")")
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$port/minio/health/live" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$port/minio/health/live" >/dev/null || { echo "minio-check: MinIO did not start" >&2; exit 1; }

if ! command -v aws >/dev/null; then
  mkdir -p "$root/bin"
  cat >"$root/bin/aws" <<SHIM
#!/usr/bin/env bash
exec docker run --rm --network host -u "\$(id -u):\$(id -g)" -e HOME=/tmp \\
  -e AWS_ENDPOINT_URL -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION -e AWS_CONFIG_FILE \\
  -e AWS_SHARED_CREDENTIALS_FILE -e AWS_EC2_METADATA_DISABLED -e AWS_PAGER \\
  -e AWS_REQUEST_CHECKSUM_CALCULATION -e AWS_RESPONSE_CHECKSUM_VALIDATION \\
  -v "$root:$root" -w "$root" $AWS_IMAGE "\$@"
SHIM
  chmod +x "$root/bin/aws"
  export PATH="$root/bin:$PATH"
fi
# apt-repo.sh keeps its temp files under $root, which the aws container sees
export TMPDIR="$root"

printf '[default]\ns3 =\n    addressing_style = path\n' >"$root/aws-config"
s3() {
  AWS_ACCESS_KEY_ID="$OFFICE_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$OFFICE_S3_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION="$OFFICE_S3_REGION" AWS_CONFIG_FILE="$root/aws-config" \
    AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_EC2_METADATA_DISABLED=true AWS_PAGER='' \
    AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    aws --endpoint-url "$OFFICE_S3_ENDPOINT" "$@"
}

for _ in $(seq 1 30); do
  s3 s3api head-bucket --bucket "$bucket" >/dev/null 2>&1 && break
  sleep 1
done
cat >"$root/policy.json" <<POLICY
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::$bucket/*"]}]}
POLICY
s3 s3api put-bucket-policy --bucket "$bucket" --policy "file://$root/policy.json"

# --- test key and releases ----------------------------------------------------------

export GNUPGHOME="$root/gnupg"
mkdir -m 700 "$GNUPGHOME"
APT_GPG_PASSPHRASE="$(head -c 18 /dev/urandom | base64)"
export APT_GPG_PASSPHRASE
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --quick-gen-key 'Apt Check <apt-check@example.invalid>' ed25519 sign never 3<<<"$APT_GPG_PASSPHRASE"
APT_REPO_EXPECT_FPR="$(gpg --batch --with-colons --list-secret-keys | awk -F: '$1 == "fpr" { print $10; exit }')"
export APT_REPO_EXPECT_FPR
APT_GPG_PRIVATE_KEY="$(gpg --batch --pinentry-mode loopback --passphrase-fd 3 --armor \
  --export-secret-keys "$APT_REPO_EXPECT_FPR" 3<<<"$APT_GPG_PASSPHRASE")"
export APT_GPG_PRIVATE_KEY
# the public key and the deb822 source the fake debs ship, like the real deb's resources/apt
gpg --batch --export "$APT_REPO_EXPECT_FPR" >"$root/pubkey.gpg"
repo_url="http://127.0.0.1:$port/$bucket/apt"
cat >"$root/uniwork-office.sources" <<SOURCES
# managed by uniwork-office
Types: deb
URIs: $repo_url
Suites: $CHANNEL
Components: main
Architectures: amd64
Signed-By: /usr/share/keyrings/uniwork-office-archive-keyring.gpg
SOURCES
gpgconf --kill all
unset GNUPGHOME
# another key for the "wrong key.gpg" case
mkdir -m 700 "$root/gnupg-other"
GNUPGHOME="$root/gnupg-other" gpg --batch --quiet --pinentry-mode loopback --passphrase '' \
  --quick-gen-key 'Other Key <other-key@example.invalid>' ed25519 sign never
GNUPGHOME="$root/gnupg-other" gpg --batch --export >"$root/otherkey.gpg"
GNUPGHOME="$root/gnupg-other" gpgconf --kill all

make_release() {
  local version="$1" out="$root/release-$1" pkg="$root/pkg-$1"
  local prefix="UniWork-Office_${version}_unsigned"
  mkdir -p "$out" "$pkg/DEBIAN" "$pkg/opt/uniwork-office/resources/apt"
  cp "$root/pubkey.gpg" "$pkg/opt/uniwork-office/resources/apt/uniwork-office-archive-keyring.gpg"
  cp "$root/uniwork-office.sources" "$pkg/opt/uniwork-office/resources/apt/uniwork-office.sources"
  # the path apt-repo.sh looks for before it publishes the latest copy (a deb built with UNIWORK_APT_SOURCE=true)
  mkdir -p "$pkg/opt/UniWork Office/resources/apt"
  cp "$root/uniwork-office.sources" "$pkg/opt/UniWork Office/resources/apt/uniwork-office.sources"
  # like the real postinst: the keyring first, the source only when it is in place
  cat >"$pkg/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
res=/opt/uniwork-office/resources/apt
install -D -m 0644 "$res/uniwork-office-archive-keyring.gpg" /usr/share/keyrings/uniwork-office-archive-keyring.gpg \
  && install -D -m 0644 "$res/uniwork-office.sources" /etc/apt/sources.list.d/uniwork-office.sources || true
exit 0
POSTINST
  chmod 0755 "$pkg/DEBIAN/postinst"
  echo "$version" >"$pkg/opt/uniwork-office/VERSION"
  local tilde='~' deb_version
  deb_version="${version//-/$tilde}"
  printf 'Package: uniwork-office\nVersion: %s\nArchitecture: amd64\nMaintainer: Check <check@example.invalid>\nDescription: apt repository check package\n' \
    "$deb_version" >"$pkg/DEBIAN/control"
  dpkg-deb --root-owner-group --build "$pkg" "$out/${prefix}_linux_x64.deb" >/dev/null
  echo "exe $version" >"$out/${prefix}_win32_x64-setup.exe"
  echo "appimage $version" >"$out/${prefix}_linux_x64.AppImage"
  printf 'version: %s\nfiles:\n  - url: %s\npath: %s\n' "$version" "${prefix}_win32_x64-setup.exe" \
    "${prefix}_win32_x64-setup.exe" >"$out/$CHANNEL.yml"
  printf 'version: %s\nfiles:\n  - url: %s\npath: %s\n' "$version" "${prefix}_linux_x64.AppImage" \
    "${prefix}_linux_x64.AppImage" >"$out/$CHANNEL-linux.yml"
  (cd "$out" && sha256sum -- *_linux_x64.* >SHA256SUMS-linux-x64.txt)
  echo "$out"
}

publish() {
  step "publish $1"
  bash "$here/apt-repo.sh" --dir "$(make_release "$1")" --channel "$CHANNEL" --version "$1" --git-sha "$GIT_SHA"
}

publish "$V1"
curl -fsS "$repo_url/key.gpg" -o "$root/key.gpg"
cmp "$root/key.gpg" "$root/pubkey.gpg"
curl -fsS "http://127.0.0.1:$port/$bucket/releases.json" | node -e \
  'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { const m = JSON.parse(s); if (m.channels.dev.latest !== process.argv[1]) process.exit(1) })' "$V1"

# install.sh sits at the bucket root, byte-identical, served as text and never cached
bucket_url="http://127.0.0.1:$port/$bucket"
curl -fsS "$bucket_url/install.sh" -o "$root/install.sh.published"
cmp "$root/install.sh.published" "$here/install.sh" || fail "the published install.sh differs from tools/release/install.sh"
curl -fsSI "$bucket_url/install.sh" | tr -d '\r' >"$root/install.sh.headers"
grep -qi '^content-type: text/plain; charset=utf-8$' "$root/install.sh.headers" ||
  fail "install.sh is not served as text/plain; charset=utf-8"
grep -qi '^cache-control: no-cache$' "$root/install.sh.headers" || fail "install.sh is not served with Cache-Control: no-cache"
grep -qF "$RELEASE_FPR" "$here/install.sh" || fail "install.sh does not carry the release fingerprint"
step "install.sh published: byte-identical, text/plain, no-cache"

# --- apt clients --------------------------------------------------------------------

latest_url="http://127.0.0.1:$port/$bucket/apt/latest/$CHANNEL/uniwork-office_amd64.deb"

in_client() {
  docker exec "$1" bash -c "$2"
}

installed_version() {
  in_client "$1" "dpkg-query -W -f '\${Version}' uniwork-office:amd64"
}

clients=()
for image in "${CLIENTS[@]}"; do
  id="$(docker run -d --network host "$image" sleep infinity)"
  containers+=("$id")
  clients+=("$id")
  step "$image: install wget, then the one command from apt/latest ($V1)"
  in_client "$id" 'apt-get update -q >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -q wget >/dev/null'
  # only the UniWork source from here on, so the upgrade below touches nothing else;
  # on an arm64 host the amd64 package needs the foreign architecture (not part of the one command)
  # shellcheck disable=SC2016
  in_client "$id" 'rm -f /etc/apt/sources.list /etc/apt/sources.list.d/* && rm -rf /var/lib/apt/lists/*
    if [ "$(dpkg --print-architecture)" != amd64 ]; then dpkg --add-architecture amd64; fi'
  in_client "$id" "wget -qO /tmp/uniwork-office.deb $latest_url && DEBIAN_FRONTEND=noninteractive apt install -y /tmp/uniwork-office.deb >/dev/null"
  [ "$(installed_version "$id")" = "$D1" ] || { echo "minio-check: $image did not install $D1" >&2; exit 1; }
  in_client "$id" 'head -n 1 /etc/apt/sources.list.d/uniwork-office.sources | grep -qx "# managed by uniwork-office"' ||
    { echo "minio-check: $image: the postinst wrote no source" >&2; exit 1; }
done

# --- install script clients ----------------------------------------------------------
# Clean clients that have neither curl nor gpg: curl and ca-certificates are client setup only,
# the script has to install gpg itself. On a host that is not amd64 the clients are native (user-mode
# emulation crashes cmp and grep) and only the piped copy of the script is told the machine is amd64;
# the package is then installed through a foreign amd64 architecture, like the wget clients do.
host_arch="$(dpkg --print-architecture)"
arch_sed=''
if [ "$host_arch" != amd64 ]; then arch_sed="-e 's/dpkg --print-architecture/echo amd64/'"; fi

install_url="$bucket_url/install.sh"
sha_in_client() {
  in_client "$1" "sha256sum $KEYRING $LIST | cut -d' ' -f1 | paste -sd' '"
}
untouched() {
  in_client "$1" "! [ -e $KEYRING ] && ! [ -e $LIST ]" || fail "$2: a refused run wrote the keyring or the source"
}
# script_cmd <channel> [raw]: the piped command; the release fingerprint is swapped for the test key's unless raw
# (raw keeps the same pipe shape with a sed that matches nothing: the string @@none@@ is not in install.sh)
script_cmd() {
  if [ "${2:-}" = raw ]; then
    echo "export UNIWORK_OFFICE_REPO_URL=$bucket_url; set -o pipefail; curl -fsSL $install_url | sed -e 's/@@none@@/x/' $arch_sed | sh -s -- $1"
  else
    echo "export UNIWORK_OFFICE_REPO_URL=$bucket_url; set -o pipefail; curl -fsSL $install_url | sed -e 's/$RELEASE_FPR/$APT_REPO_EXPECT_FPR/' $arch_sed | sh -s -- $1"
  fi
}
# expect_script_refused <container> <image> <what> <message pattern> <command> [user]
expect_script_refused() {
  local id="$1" image="$2" what="$3" pattern="$4" cmd="$5" user="${6:-root}"
  if docker exec -u "$user" "$id" bash -c "$cmd" >"$root/script.log" 2>&1; then
    cat "$root/script.log" >&2
    fail "$image: $what was not refused"
  fi
  grep -Eq -- "$pattern" "$root/script.log" || { cat "$root/script.log" >&2; fail "$image: $what: unexpected refusal text"; }
  untouched "$id" "$image"
  step "$image: $what refused, nothing written"
}

script_clients=()
for image in "${CLIENTS[@]}"; do
  id="$(docker run -d --network host "$image" sleep infinity)"
  containers+=("$id")
  script_clients+=("$id")
  step "$image: install.sh client setup (curl and ca-certificates only)"
  in_client "$id" 'apt-get update -q >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -q curl ca-certificates >/dev/null'
  in_client "$id" '! command -v gpg >/dev/null && ! command -v wget >/dev/null' || fail "$image: the client already has gpg or wget"
  in_client "$id" 'useradd -m tester'

  expect_script_refused "$id" "$image" "non-root run" 'sudo' "$(script_cmd dev)" tester
  expect_script_refused "$id" "$image" "unpublished channel stable" \
    'channel stable is not published yet; try: curl -fsSL .*/install\.sh \| sudo sh -s -- dev' "$(script_cmd stable)"
  in_client "$id" '! command -v gpg >/dev/null' || fail "$image: a refused run installed gpg"
  expect_script_refused "$id" "$image" "release fingerprint check against the test key" \
    "expected $RELEASE_FPR" "$(script_cmd dev raw)"
  s3 s3 cp --only-show-errors "$root/otherkey.gpg" "s3://$bucket/apt/key.gpg"
  expect_script_refused "$id" "$image" "wrong key.gpg" "expected $APT_REPO_EXPECT_FPR" "$(script_cmd dev)"
  s3 s3 cp --only-show-errors "$root/pubkey.gpg" "s3://$bucket/apt/key.gpg"
  # the refusals above needed gpg, so the script installed it; the install below has to again
  in_client "$id" 'DEBIAN_FRONTEND=noninteractive apt-get remove -y -q gpg >/dev/null && ! command -v gpg >/dev/null'

  if [ "$host_arch" != amd64 ]; then
    # the Ubuntu mirrors of this host's architecture have no amd64 index: keep them to their own architecture
    in_client "$id" "dpkg --add-architecture amd64
      if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then sed -i '/^Types:/a Architectures: $host_arch' /etc/apt/sources.list.d/ubuntu.sources; fi
      if [ -f /etc/apt/sources.list ]; then sed -i 's/^deb /deb [arch=$host_arch] /' /etc/apt/sources.list; fi"
  fi
  step "$image: install.sh dev installs $V1"
  in_client "$id" "$(script_cmd dev)" >"$root/script.log" 2>&1 || { cat "$root/script.log" >&2; fail "$image: install.sh failed"; }
  grep -q 'installing gpg' "$root/script.log" || fail "$image: the script did not install gpg"
  [ "$(installed_version "$id")" = "$D1" ] || fail "$image: install.sh did not install $D1"
  host_sums="$(sha256sum "$root/pubkey.gpg" "$root/uniwork-office.sources" | cut -d' ' -f1 | paste -sd' ')"
  [ "$(sha_in_client "$id")" = "$host_sums" ] || fail "$image: keyring or source differs from the deb's"
  [ "$(in_client "$id" "head -n 1 $LIST")" = '# managed by uniwork-office' ] || fail "$image: the source is not marked as managed"
  step "$image: keyring and source byte-equal to the deb's, $V1 installed"

  step "$image: second run changes nothing"
  before="$(sha_in_client "$id")"
  in_client "$id" "$(script_cmd dev)" >"$root/script.log" 2>&1 || { cat "$root/script.log" >&2; fail "$image: the second run failed"; }
  [ "$(sha_in_client "$id")" = "$before" ] || fail "$image: the second run changed a file"
  if [ "$(grep -c 'is up to date' "$root/script.log")" != 2 ] || grep -q 'wrote ' "$root/script.log"; then
    cat "$root/script.log" >&2
    fail "$image: the second run rewrote a file the deb already shipped"
  fi
  [ "$(installed_version "$id")" = "$D1" ] || fail "$image: the second run changed the version"
  step "$image: second run exit 0, files unchanged ($before)"

  # a source file without our first line is the admin's own: kept, one line, install goes on
  in_client "$id" "cp $LIST /root/managed.sources && sed 1d /root/managed.sources >$LIST"
  admin_sum="$(in_client "$id" "sha256sum $LIST")"
  in_client "$id" "$(script_cmd dev)" >"$root/script.log" 2>&1 || { cat "$root/script.log" >&2; fail "$image: the run beside an admin source failed"; }
  [ "$(in_client "$id" "sha256sum $LIST")" = "$admin_sum" ] || fail "$image: the admin's source was changed"
  grep -q 'is not managed by UniWork Office, left as is' "$root/script.log" || fail "$image: no line about the admin's source"
  in_client "$id" "cp /root/managed.sources $LIST"
  step "$image: admin-owned source left untouched"
done

publish "$V2"
for i in "${!script_clients[@]}"; do
  id="${script_clients[i]}"
  step "${CLIENTS[i]}: apt-get upgrade -y to $V2 after install.sh"
  # only the UniWork source from here on, so the upgrade touches nothing else
  in_client "$id" "find /etc/apt/sources.list.d -type f ! -name uniwork-office.sources -delete; rm -f /etc/apt/sources.list; rm -rf /var/lib/apt/lists/*"
  in_client "$id" 'apt-get update -q >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -q >/dev/null'
  [ "$(installed_version "$id")" = "$D2" ] || fail "${CLIENTS[i]} did not upgrade to $D2 after install.sh"
done

for i in "${!clients[@]}"; do
  id="${clients[i]}"
  step "${CLIENTS[i]}: apt update && apt upgrade -y to $V2"
  in_client "$id" 'apt update -q && DEBIAN_FRONTEND=noninteractive apt upgrade -y -q >/dev/null'
  [ "$(installed_version "$id")" = "$D2" ] || { echo "minio-check: ${CLIENTS[i]} did not upgrade to $D2" >&2; exit 1; }
done

# --- tampering ------------------------------------------------------------------------

expect_refused() {
  local what="$1"
  for i in "${!clients[@]}"; do
    id="${clients[i]}"
    in_client "$id" 'rm -rf /var/lib/apt/lists/*'
    if in_client "$id" 'apt-get update -q' >"$root/update.log" 2>&1 && ! grep -q '^[WE]:' "$root/update.log"; then
      cat "$root/update.log" >&2
      echo "minio-check: ${CLIENTS[i]} accepted a tampered $what" >&2
      exit 1
    fi
    step "${CLIENTS[i]}: tampered $what refused ($(grep -m1 -E '^[WE]:' "$root/update.log" || echo 'update failed'))"
  done
}

dists="s3://$bucket/apt/dists/$CHANNEL"
s3 s3 cp --only-show-errors "$dists/InRelease" "$root/InRelease.good"
sed 's/^Label: UniWork Office$/Label: UniWork Offic3/' "$root/InRelease.good" >"$root/InRelease.bad"
s3 s3 cp --only-show-errors "$root/InRelease.bad" "$dists/InRelease"
expect_refused InRelease
s3 s3 cp --only-show-errors "$root/InRelease.good" "$dists/InRelease"

# Every copy of the index a client could fetch (plain and by-hash) gets a
# changed Packages; the signed Release still names the real hashes.
s3 s3 cp --only-show-errors "$dists/main/binary-amd64/Packages" "$root/Packages"
sed -i 's/^Description: .*/Description: tampered/' "$root/Packages"
gzip -9nc "$root/Packages" >"$root/Packages.gz"
xz -9c "$root/Packages" >"$root/Packages.xz"
for name in Packages Packages.gz Packages.xz; do
  s3 s3 cp --only-show-errors "$root/$name" "$dists/main/binary-amd64/$name"
done
s3 s3 cp --only-show-errors "$dists/Release" "$root/Release"
awk '/^SHA256:/ { on = 1; next } /^[^ ]/ { on = 0 } on && NF == 3 { print $1, $3 }' "$root/Release" |
  while read -r hash path; do
    s3 s3 cp --only-show-errors "$root/${path##*/}" "$dists/main/binary-amd64/by-hash/SHA256/$hash" </dev/null
  done
expect_refused Packages
