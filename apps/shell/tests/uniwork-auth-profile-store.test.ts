import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readUserProfile,
  type DeploymentChannel,
  type DeploymentProfile,
} from '../src/main/uniwork-auth/deployment'
import {
  createProfileApplier,
  decideProfileChange,
  profileFromAddress,
  serializeProfileApplies,
  writeUserProfile,
  type ProfileApplierDeps,
} from '../src/main/uniwork-auth/profile-store'

const require = createRequire(import.meta.url)
const { bakedDeploymentDefaults } = require('../build/deployment-defaults.cjs') as {
  bakedDeploymentDefaults: (
    env: Record<string, string | undefined>,
    channel: string,
  ) => { channel: string; defaultProfile?: { deploymentId: string; apiOrigin: string } }
}

const profile = (over: Partial<DeploymentProfile> = {}): DeploymentProfile => ({
  deploymentId: 'acme',
  apiOrigin: 'https://acme.example',
  clientId: 'uniwork-office',
  channel: 'stable',
  ...over,
})

describe('decideProfileChange', () => {
  it('refuses a profile of another channel, saved or not', () => {
    expect(
      decideProfileChange(
        null,
        profile({ channel: 'dev', clientId: 'uniwork-office-dev' }),
        'stable',
      ),
    ).toBe('refuse')
    expect(decideProfileChange(profile(), profile({ channel: 'beta' }), 'stable')).toBe('refuse')
  })
  it('the same deployment id: unchanged, or a silent update when the origin moved', () => {
    expect(decideProfileChange(profile(), profile(), 'stable')).toBe('unchanged')
    expect(
      decideProfileChange(profile(), profile({ apiOrigin: 'https://new.example' }), 'stable'),
    ).toBe('update')
  })
  it('no profile yet, or another deployment id: ask', () => {
    expect(decideProfileChange(null, profile(), 'stable')).toBe('confirm')
    expect(decideProfileChange(profile(), profile({ deploymentId: 'other' }), 'stable')).toBe(
      'confirm',
    )
  })
})

describe('profile applier', () => {
  function setup(
    options: Partial<Omit<ProfileApplierDeps, 'current'>> & {
      current?: DeploymentProfile | null
    } = {},
  ) {
    const { current: saved, ...over } = options
    const calls: string[] = []
    const deps: ProfileApplierDeps = {
      appChannel: () => 'stable' as DeploymentChannel,
      current: () => (saved === undefined ? profile() : saved),
      confirm: vi.fn(async () => {
        calls.push('confirm')
        return true
      }),
      endSession: vi.fn(async () => {
        calls.push('endSession')
        return true
      }),
      save: vi.fn(() => {
        calls.push('save')
      }),
      adopt: vi.fn(async () => {
        calls.push('adopt')
      }),
      ...over,
    }
    return { applier: createProfileApplier(deps), deps, calls }
  }

  it('same deployment id with a new origin: no question, the old sign-in ends through the hooks', async () => {
    const { applier, deps, calls } = setup()
    const next = profile({ apiOrigin: 'https://new.example' })
    expect(await applier.apply(next)).toBe('applied')
    expect(calls).toEqual(['endSession', 'save', 'adopt'])
    expect(deps.confirm).not.toHaveBeenCalled()
  })

  it('a moved origin whose close prompt is cancelled changes nothing', async () => {
    const { applier, deps } = setup({ endSession: vi.fn(async () => false) })
    expect(await applier.apply(profile({ apiOrigin: 'https://new.example' }))).toBe('declined')
    expect(deps.save).not.toHaveBeenCalled()
    expect(deps.adopt).not.toHaveBeenCalled()
  })

  it('a new deployment id asks once, ends the old session, then saves and adopts', async () => {
    const { applier, deps, calls } = setup()
    expect(
      await applier.apply(profile({ deploymentId: 'other', apiOrigin: 'https://o.example' })),
    ).toBe('applied')
    expect(deps.confirm).toHaveBeenCalledWith('https://o.example')
    expect(calls).toEqual(['confirm', 'endSession', 'save', 'adopt'])
  })

  it('no saved profile asks too', async () => {
    const { applier, calls } = setup({ current: null })
    expect(await applier.apply(profile())).toBe('applied')
    expect(calls).toEqual(['confirm', 'endSession', 'save', 'adopt'])
  })

  it('declining changes nothing', async () => {
    const { applier, calls } = setup({ confirm: vi.fn(async () => false), current: null })
    expect(await applier.apply(profile())).toBe('declined')
    expect(calls).toEqual([])
  })

  it('cancelling the sign-out prompt changes nothing', async () => {
    const { applier, deps } = setup({ endSession: vi.fn(async () => false) })
    expect(await applier.apply(profile({ deploymentId: 'other' }))).toBe('declined')
    expect(deps.save).not.toHaveBeenCalled()
    expect(deps.adopt).not.toHaveBeenCalled()
  })

  it('another channel is refused with no prompt and no change', async () => {
    const { applier, deps } = setup()
    expect(await applier.apply(profile({ channel: 'dev', clientId: 'uniwork-office-dev' }))).toBe(
      'refused',
    )
    expect(deps.confirm).not.toHaveBeenCalled()
    expect(deps.save).not.toHaveBeenCalled()
  })

  it('the same profile is unchanged; a typed address (confirmed) skips the question', async () => {
    const same = setup()
    expect(await same.applier.apply(profile())).toBe('unchanged')
    expect(same.calls).toEqual([])
    const typed = setup({ current: null })
    expect(await typed.applier.apply(profile(), { confirmed: true })).toBe('applied')
    expect(typed.deps.confirm).not.toHaveBeenCalled()
    expect(typed.calls).toEqual(['endSession', 'save', 'adopt'])
  })

  it('a failed write is refused and nothing is adopted', async () => {
    const { applier, deps } = setup({
      save: vi.fn(() => {
        throw new Error('EACCES')
      }),
    })
    expect(await applier.apply(profile({ apiOrigin: 'https://new.example' }))).toBe('refused')
    expect(deps.adopt).not.toHaveBeenCalled()
  })
})

describe('serializeProfileApplies', () => {
  it('drops a link while a change is open, queues a typed address, decides each in turn', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const order: string[] = []
    const apply = serializeProfileApplies(
      async (incoming: DeploymentProfile, _options: { confirmed?: boolean }) => {
        order.push(`start ${incoming.deploymentId}`)
        if (incoming.deploymentId === 'first') await gate
        order.push(`end ${incoming.deploymentId}`)
        return 'applied' as const
      },
    )
    const first = apply(profile({ deploymentId: 'first' }), {})
    const burst = apply(profile({ deploymentId: 'burst' }), {})
    const typed = apply(profile({ deploymentId: 'typed' }), { confirmed: true })
    expect(await burst).toBe('declined')
    release()
    expect(await first).toBe('applied')
    expect(await typed).toBe('applied')
    expect(order).toEqual(['start first', 'end first', 'start typed', 'end typed'])
    // idle again: the next link runs
    expect(await apply(profile({ deploymentId: 'later' }), {})).toBe('applied')
  })
})

describe('userData profile file', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('is written atomically and read back for the same channel only', () => {
    dir = mkdtempSync(join(tmpdir(), 'uw-profile-'))
    writeUserProfile(dir, profile())
    expect(JSON.parse(readFileSync(join(dir, 'deployment-profile.json'), 'utf8'))).toEqual(
      profile(),
    )
    expect(readUserProfile(dir, 'stable')).toEqual(profile())
    expect(readUserProfile(dir, 'dev')).toBeNull()
  })
})

describe('profileFromAddress (the typed address)', () => {
  const answer = (body: unknown, ok = true) =>
    vi.fn(async (_url: string, _init: RequestInit) =>
      ok ? new Response(JSON.stringify(body), { status: 200 }) : Promise.reject(new Error('down')),
    )

  it('takes the deployment id from the server config', async () => {
    const fetch = answer({ office_deployment_id: 'production-eu' })
    const result = await profileFromAddress('uniwork.example/', 'stable', fetch)
    expect(result).toEqual({
      ok: true,
      profile: {
        deploymentId: 'production-eu',
        apiOrigin: 'https://uniwork.example',
        clientId: 'uniwork-office',
        channel: 'stable',
      },
    })
    expect(fetch.mock.calls[0]![0]).toBe('https://uniwork.example/api/v1/config')
  })

  it('does not read past 64 KB of a typed host answer', async () => {
    const huge = JSON.stringify({ office_deployment_id: 'big', pad: 'x'.repeat(70 * 1024) })
    const fetch = vi.fn(async () => new Response(huge, { status: 200 }))
    const result = await profileFromAddress('https://uniwork.example', 'stable', fetch)
    expect(result).toMatchObject({ ok: true, profile: { deploymentId: 'default' } })
  })

  it('keeps the default id when the server answers without one', async () => {
    const result = await profileFromAddress('https://uniwork.example', 'stable', answer({}))
    expect(result).toMatchObject({ ok: true, profile: { deploymentId: 'default' } })
  })

  it('refuses http outside dev loopback, a path, and an empty address', async () => {
    const fetch = answer({})
    for (const bad of ['http://uniwork.example', 'https://uniwork.example/app', '  ']) {
      expect(await profileFromAddress(bad, 'stable', fetch)).toEqual({
        ok: false,
        error: 'invalid_address',
      })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('dev accepts a loopback address over http', async () => {
    const result = await profileFromAddress('localhost:8080', 'dev', answer({}))
    expect(result).toMatchObject({
      ok: true,
      profile: {
        apiOrigin: 'http://localhost:8080',
        clientId: 'uniwork-office-dev',
        channel: 'dev',
      },
    })
  })

  it('a server that does not answer is not saved', async () => {
    expect(await profileFromAddress('uniwork.example', 'stable', answer(null, false))).toEqual({
      ok: false,
      error: 'unreachable',
    })
  })
})

describe('baked default (release env)', () => {
  it('empty env means no default, only the channel', () => {
    expect(bakedDeploymentDefaults({}, 'dev')).toEqual({ channel: 'dev' })
  })
  it('bakes a valid pair as a normalized origin', () => {
    expect(
      bakedDeploymentDefaults(
        {
          UNIWORK_DEFAULT_API_ORIGIN: 'https://uniwork.example/',
          UNIWORK_DEFAULT_DEPLOYMENT_ID: 'prod',
        },
        'beta',
      ),
    ).toEqual({
      channel: 'beta',
      defaultProfile: { deploymentId: 'prod', apiOrigin: 'https://uniwork.example' },
    })
  })
  it('fails the build on half a pair, a bad id, http, or a path', () => {
    const id = 'UNIWORK_DEFAULT_DEPLOYMENT_ID'
    const origin = 'UNIWORK_DEFAULT_API_ORIGIN'
    expect(() => bakedDeploymentDefaults({ [origin]: 'https://a.example' }, 'dev')).toThrow(
      /together/,
    )
    expect(() => bakedDeploymentDefaults({ [id]: 'prod' }, 'dev')).toThrow(/together/)
    expect(() =>
      bakedDeploymentDefaults({ [origin]: 'https://a.example', [id]: '-bad' }, 'dev'),
    ).toThrow(/deployment id/)
    expect(() =>
      bakedDeploymentDefaults({ [origin]: 'http://a.example', [id]: 'p' }, 'beta'),
    ).toThrow(/https/)
    expect(() =>
      bakedDeploymentDefaults({ [origin]: 'https://a.example/x', [id]: 'p' }, 'dev'),
    ).toThrow(/bare origin/)
    // http loopback only on dev
    expect(
      bakedDeploymentDefaults({ [origin]: 'http://localhost:8080', [id]: 'p' }, 'dev')
        .defaultProfile,
    ).toBeTruthy()
    expect(() =>
      bakedDeploymentDefaults({ [origin]: 'http://localhost:8080', [id]: 'p' }, 'beta'),
    ).toThrow(/https/)
  })
})
