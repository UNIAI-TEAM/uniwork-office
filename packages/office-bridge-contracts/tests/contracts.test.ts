import { describe, expect, it } from 'vitest'
import {
  LAUNCH_TOKEN_TTL_MS,
  officeLaunchExchangeRequestSchema,
  officeSessionCreateRequestSchema,
} from '../src/index'

describe('office-bridge-contracts', () => {
  it('keeps launch TTL in the 1–5 minute window', () => {
    expect(LAUNCH_TOKEN_TTL_MS).toBeGreaterThanOrEqual(60_000)
    expect(LAUNCH_TOKEN_TTL_MS).toBeLessThanOrEqual(5 * 60_000)
  })

  it('rejects empty create payloads', () => {
    expect(officeSessionCreateRequestSchema.safeParse({}).success).toBe(false)
  })

  it('rejects short launch tokens', () => {
    expect(officeLaunchExchangeRequestSchema.safeParse({ token: 'short' }).success).toBe(false)
  })

  it('accepts live create and exchange bodies', () => {
    expect(
      officeSessionCreateRequestSchema.safeParse({
        documentId: 'dd35c3e8-0639-4faf-b229-619e1a9fe5bb',
      }).success,
    ).toBe(true)
    expect(officeSessionCreateRequestSchema.safeParse({ workProductId: 'x' }).success).toBe(false)
    expect(
      officeLaunchExchangeRequestSchema.safeParse({ token: 'olt_' + 'a'.repeat(40) }).success,
    ).toBe(true)
    expect(
      officeLaunchExchangeRequestSchema.safeParse({ launchToken: 'olt_' + 'a'.repeat(40) }).success,
    ).toBe(false)
  })
})
