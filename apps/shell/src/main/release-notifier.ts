import { net } from 'electron'

/**
 * Update notice for the unsigned mac release app. Squirrel.Mac installs an
 * update only into an app signed with a stable Developer ID, and the ad-hoc
 * signature of each unsigned build differs, so the mac app carries no
 * electron-updater feed. It still learns about newer builds: the release job
 * bakes the GitHub repository and release channel into package.json
 * (uniworkReleaseFeed), and the app reads that repository's releases and
 * points the user at the newer dmg for its own arch, to install by hand.
 */

export interface ReleaseFeed {
  owner: string
  repo: string
  channel: string
}

export interface MacRelease {
  version: string
  downloadUrl: string
}

const OWNER = /^[A-Za-z0-9-]+$/
const REPO = /^[A-Za-z0-9._-]+$/
const CHANNELS = ['dev', 'beta']
// one page is plenty: dev builds are tagged a few times a week at most
const RELEASES_PER_PAGE = 30

/** The baked uniworkReleaseFeed value, or null when it is missing or malformed. */
export function parseReleaseFeed(value: unknown): ReleaseFeed | null {
  if (typeof value !== 'object' || value === null) return null
  const { owner, repo, channel } = value as Record<string, unknown>
  if (typeof owner !== 'string' || !OWNER.test(owner)) return null
  if (typeof repo !== 'string' || !REPO.test(repo)) return null
  if (typeof channel !== 'string' || !CHANNELS.includes(channel)) return null
  return { owner, repo, channel }
}

/** x.y.z-<channel>.n -> [x, y, z, n]; null for any other shape or channel. */
export function channelVersion(version: string, channel: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)-([a-z]+)\.(\d+)$/.exec(version)
  if (!match || match[4] !== channel) return null
  return [match[1], match[2], match[3], match[5]].map(Number)
}

function newer(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

/**
 * The newest published release of the feed's channel above `current` that
 * carries a dmg for `arch`, or null. Releases come from the GitHub API, so
 * only the tag and the asset name are read, and the download URL is rebuilt
 * on the baked repository rather than taken from the response.
 */
export function pickMacRelease(
  releases: unknown,
  feed: ReleaseFeed,
  current: string,
  arch: string,
): MacRelease | null {
  const floor = channelVersion(current, feed.channel)
  if (floor === null || !Array.isArray(releases)) return null
  let best: { parts: number[]; release: MacRelease } | null = null
  for (const entry of releases as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const { tag_name: tag, draft, assets } = entry as Record<string, unknown>
    if (draft === true || typeof tag !== 'string' || !tag.startsWith('v')) continue
    const version = tag.slice(1)
    const parts = channelVersion(version, feed.channel)
    if (parts === null || !newer(parts, floor)) continue
    if (best !== null && !newer(parts, best.parts)) continue
    const dmg = (Array.isArray(assets) ? (assets as unknown[]) : [])
      .map((asset) =>
        typeof asset === 'object' && asset !== null ? (asset as { name?: unknown }).name : null,
      )
      .find(
        (name): name is string =>
          typeof name === 'string' &&
          name.startsWith(`UniWork-Office_${version}_`) &&
          name.endsWith(`_darwin_${arch}.dmg`),
      )
    if (dmg === undefined) continue
    const downloadUrl =
      `https://github.com/${feed.owner}/${feed.repo}/releases/download/` +
      `${encodeURIComponent(tag)}/${encodeURIComponent(dmg)}`
    best = { parts, release: { version, downloadUrl } }
  }
  return best?.release ?? null
}

/** Reads the feed's releases; throws when GitHub cannot be reached or answers an error. */
export async function latestMacRelease(
  feed: ReleaseFeed,
  current: string,
  arch: string,
): Promise<MacRelease | null> {
  const url = `https://api.github.com/repos/${feed.owner}/${feed.repo}/releases?per_page=${RELEASES_PER_PAGE}`
  const response = await net.fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  })
  if (!response.ok) throw new Error(`GitHub releases answered ${response.status}`)
  return pickMacRelease(await response.json(), feed, current, arch)
}
