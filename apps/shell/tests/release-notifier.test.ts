import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import { channelVersion, parseReleaseFeed, pickMacRelease } from '../src/main/release-notifier'

/** Release lookup of the unsigned mac app (src/main/release-notifier.ts). */

const feed = { owner: 'UNIAI-TEAM', repo: 'uniwork-office', channel: 'dev' }
const dmg = (version: string, arch: string, label = '_unsigned') =>
  `UniWork-Office_${version}${label}_darwin_${arch}.dmg`
const release = (version: string, extra: Record<string, unknown> = {}) => ({
  tag_name: `v${version}`,
  draft: false,
  assets: [{ name: dmg(version, 'arm64') }, { name: dmg(version, 'x64') }],
  ...extra,
})

describe('parseReleaseFeed', () => {
  it('accepts a github owner / repo on dev or beta', () => {
    expect(parseReleaseFeed(feed)).toEqual(feed)
    expect(parseReleaseFeed({ ...feed, channel: 'beta' })).toEqual({ ...feed, channel: 'beta' })
  })

  it('refuses anything else', () => {
    for (const value of [
      undefined,
      null,
      'UNIAI-TEAM/uniwork-office',
      { ...feed, channel: 'latest' },
      { ...feed, owner: 'a/b' },
      { ...feed, repo: '../x' },
      { owner: 'UNIAI-TEAM', channel: 'dev' },
    ]) {
      expect(parseReleaseFeed(value)).toBeNull()
    }
  })
})

describe('channelVersion', () => {
  it('reads x.y.z-<channel>.n of the given channel only', () => {
    expect(channelVersion('0.11.0-dev.12', 'dev')).toEqual([0, 11, 0, 12])
    expect(channelVersion('0.11.0-beta.1', 'dev')).toBeNull()
    expect(channelVersion('0.11.0', 'dev')).toBeNull()
  })
})

describe('pickMacRelease', () => {
  it('picks the newest release above the current version with a dmg for the arch', () => {
    const picked = pickMacRelease(
      [release('0.11.0-dev.2'), release('0.11.0-dev.10'), release('0.11.0-dev.3')],
      feed,
      '0.11.0-dev.1',
      'arm64',
    )
    expect(picked).toEqual({
      version: '0.11.0-dev.10',
      downloadUrl:
        'https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v0.11.0-dev.10/' +
        dmg('0.11.0-dev.10', 'arm64'),
    })
  })

  it('compares the base version before the build number', () => {
    const picked = pickMacRelease(
      [release('0.12.0-dev.1'), release('0.11.0-dev.9')],
      feed,
      '0.11.0-dev.1',
      'x64',
    )
    expect(picked?.version).toBe('0.12.0-dev.1')
    expect(picked?.downloadUrl.endsWith(dmg('0.12.0-dev.1', 'x64'))).toBe(true)
  })

  it('accepts a signed dmg name too', () => {
    const picked = pickMacRelease(
      [release('0.11.0-dev.2', { assets: [{ name: dmg('0.11.0-dev.2', 'arm64', '') }] })],
      feed,
      '0.11.0-dev.1',
      'arm64',
    )
    expect(picked?.downloadUrl.endsWith('/UniWork-Office_0.11.0-dev.2_darwin_arm64.dmg')).toBe(true)
  })

  it('skips drafts, other channels, older builds and releases without the arch', () => {
    const releases = [
      release('0.11.0-dev.5', { draft: true }),
      release('0.11.0-beta.9'),
      release('0.11.0-dev.1'),
      release('0.10.0-dev.30'),
      release('0.11.0-dev.4', { assets: [{ name: dmg('0.11.0-dev.4', 'x64') }] }),
      release('0.11.0-dev.3', { assets: [{ name: dmg('0.11.0-dev.2', 'arm64') }] }),
      { tag_name: 'office-0.11.0-dev.6', assets: [{ name: dmg('0.11.0-dev.6', 'arm64') }] },
      'junk',
      null,
    ]
    expect(pickMacRelease(releases, feed, '0.11.0-dev.1', 'arm64')).toBeNull()
  })

  it('never builds the URL from response fields beyond the tag and asset name', () => {
    const picked = pickMacRelease(
      [
        release('0.11.0-dev.2', {
          html_url: 'https://evil.example/',
          assets: [
            {
              name: dmg('0.11.0-dev.2', 'arm64'),
              browser_download_url: 'https://evil.example/x.dmg',
            },
          ],
        }),
      ],
      feed,
      '0.11.0-dev.1',
      'arm64',
    )
    expect(picked?.downloadUrl.startsWith('https://github.com/UNIAI-TEAM/uniwork-office/')).toBe(
      true,
    )
  })

  it('returns null for a current version off the channel or a malformed answer', () => {
    expect(pickMacRelease([release('0.11.0-dev.2')], feed, '0.11.0', 'arm64')).toBeNull()
    expect(pickMacRelease({ message: 'rate limited' }, feed, '0.11.0-dev.1', 'arm64')).toBeNull()
  })
})
