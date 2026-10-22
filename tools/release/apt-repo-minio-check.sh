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
# adds the deb822 source (Signed-By the published key.gpg) over plain http,
# installs v1, upgrades to v2 with apt-get upgrade, then proves apt-get update
# refuses a tampered InRelease and a tampered Packages. Everything it started
# (containers, volume, temp files) is removed by id at the end.
#
# Needs docker, apt-ftparchive (apt-utils), dpkg-deb, gpg, node, curl. Without
# an aws CLI on PATH it runs amazon/aws-cli in docker.
set -euo pipefail

readonly MINIO_IMAGE=bitnamilegacy/minio:2025.7.23
readonly AWS_IMAGE=amazon/aws-cli:2.27.50
readonly CLIENTS=(ubuntu:24.04 ubuntu:22.04)
readonly CHANNEL=dev
readonly V1=0.11.0-dev.1
readonly V2=0.11.0-dev.2
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
  rm -rf "$root"
  if [ "$status" = 0 ]; then echo "minio-check: PASS"; else echo "minio-check: FAIL ($status)" >&2; fi
}
trap cleanup EXIT

step() {
  echo "minio-check: $*"
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
gpgconf --kill all
unset GNUPGHOME

make_release() {
  local version="$1" out="$root/release-$1" pkg="$root/pkg-$1"
  local prefix="UniWork-Office_${version}_unsigned"
  mkdir -p "$out" "$pkg/DEBIAN" "$pkg/opt/uniwork-office"
  echo "$version" >"$pkg/opt/uniwork-office/VERSION"
  printf 'Package: uniwork-office\nVersion: %s\nArchitecture: amd64\nMaintainer: Check <check@example.invalid>\nDescription: apt repository check package\n' \
    "$version" >"$pkg/DEBIAN/control"
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
repo_url="http://127.0.0.1:$port/$bucket/apt"
curl -fsS "$repo_url/key.gpg" -o "$root/key.gpg"
curl -fsS "http://127.0.0.1:$port/$bucket/releases.json" | node -e \
  'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { const m = JSON.parse(s); if (m.channels.dev.latest !== process.argv[1]) process.exit(1) })' "$V1"

# --- apt clients --------------------------------------------------------------------

mkdir -p "$root/client"
cp "$root/key.gpg" "$root/client/key.gpg"
cat >"$root/client/setup.sh" <<CLIENT
set -eu
rm -f /etc/apt/sources.list /etc/apt/sources.list.d/*
if [ "\$(dpkg --print-architecture)" != amd64 ]; then dpkg --add-architecture amd64; fi
install -m 0644 /check/key.gpg /usr/share/keyrings/uniwork-office-archive-keyring.gpg
cat >/etc/apt/sources.list.d/uniwork-office.sources <<SOURCES
Types: deb
URIs: $repo_url
Suites: $CHANNEL
Components: main
Architectures: amd64
Signed-By: /usr/share/keyrings/uniwork-office-archive-keyring.gpg
SOURCES
CLIENT

in_client() {
  docker exec "$1" bash -c "$2"
}

installed_version() {
  in_client "$1" "dpkg-query -W -f '\${Version}' uniwork-office:amd64"
}

clients=()
for image in "${CLIENTS[@]}"; do
  id="$(docker run -d --network host -v "$root/client:/check:ro" "$image" sleep infinity)"
  containers+=("$id")
  clients+=("$id")
  step "$image: add the source, apt-get update, install $V1"
  in_client "$id" 'bash /check/setup.sh && apt-get update -q'
  in_client "$id" "DEBIAN_FRONTEND=noninteractive apt-get install -y -q uniwork-office:amd64=$V1 >/dev/null"
  [ "$(installed_version "$id")" = "$V1" ] || { echo "minio-check: $image did not install $V1" >&2; exit 1; }
done

publish "$V2"
for i in "${!clients[@]}"; do
  id="${clients[i]}"
  step "${CLIENTS[i]}: apt-get update + upgrade to $V2"
  in_client "$id" 'apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -q >/dev/null'
  [ "$(installed_version "$id")" = "$V2" ] || { echo "minio-check: ${CLIENTS[i]} did not upgrade to $V2" >&2; exit 1; }
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
