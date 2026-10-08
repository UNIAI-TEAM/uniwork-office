import { describe, expect, it } from 'vitest'
import {
  DocsProtocolError,
  PROTOCOL_NS,
  PROTOCOL_VERSION,
  errorFromHttpStatus,
  isFileSource,
  isInitPayload,
  parseEnvelope,
  toProtocolError,
  type InitPayload,
} from '../types'

const env = (over: Record<string, unknown> = {}) => ({
  ns: PROTOCOL_NS,
  v: PROTOCOL_VERSION,
  id: 'h1-abc',
  kind: 'event',
  type: 'dirty',
  payload: { dirty: true },
  ...over,
})

const init: InitPayload = {
  protocolVersion: PROTOCOL_VERSION,
  token: 'tok',
  tokenExpiresAt: 1_000,
  documentId: 'doc1',
  workspaceId: 'ws1',
  apiBase: 'https://app.uniwork.test/api',
  apiMode: 'host-proxy',
  locale: 'vi',
  theme: 'dark',
  capabilities: { save: true, ai: false },
}

describe('parseEnvelope', () => {
  it('accepts a well-formed message', () => {
    const r = parseEnvelope(env())
    expect(r).toEqual({ ok: true, message: env() })
  })

  it('ignores foreign traffic silently', () => {
    expect(parseEnvelope(null)).toEqual({ ok: false, reason: 'foreign' })
    expect(parseEnvelope('hello')).toEqual({ ok: false, reason: 'foreign' })
    expect(parseEnvelope({ type: 'webpackOk' })).toEqual({ ok: false, reason: 'foreign' })
    expect(parseEnvelope({ ...env(), ns: 'other' })).toEqual({ ok: false, reason: 'foreign' })
  })

  it.each([
    ['missing v', { v: undefined }],
    ['fractional v', { v: 1.5 }],
    ['missing id', { id: undefined }],
    ['empty id', { id: '' }],
    ['huge id', { id: 'x'.repeat(500) }],
    ['bad kind', { kind: 'push' }],
    ['missing type', { type: undefined }],
    ['error on an event', { error: { code: 'internal', message: 'x' } }],
    ['bad payload', { payload: { dirty: 'yes' } }],
    ['missing payload', { payload: undefined }],
    ['array payload on unknown type', { type: 'x.y', payload: [] }],
  ])('rejects %s as malformed', (_name, over) => {
    const r = parseEnvelope(env(over))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('malformed')
  })

  it('keeps id/kind of a malformed request so the endpoint can answer it', () => {
    const r = parseEnvelope(env({ kind: 'request', type: 'api.save', payload: { fileId: 'f' } }))
    expect(r.ok === false && r.reason === 'malformed' && r.partial).toMatchObject({
      id: 'h1-abc',
      kind: 'request',
      type: 'api.save',
    })
  })

  it('reports a version mismatch with the parsed envelope', () => {
    const r = parseEnvelope(env({ v: PROTOCOL_VERSION + 1 }))
    expect(r.ok === false && r.reason).toBe('version_mismatch')
    expect(r.ok === false && r.reason === 'version_mismatch' && r.message.v).toBe(
      PROTOCOL_VERSION + 1,
    )
  })

  it('validates known payloads per kind:type', () => {
    expect(parseEnvelope(env({ kind: 'request', type: 'init', payload: init })).ok).toBe(true)
    expect(
      parseEnvelope(env({ kind: 'request', type: 'init', payload: { ...init, theme: 'blue' } })).ok,
    ).toBe(false)
    expect(
      parseEnvelope(
        env({
          kind: 'request',
          type: 'api.save',
          payload: { fileId: 'f', data: new ArrayBuffer(2) },
        }),
      ).ok,
    ).toBe(true)
    // unknown types only need an object payload (the endpoint answers unknown_type)
    expect(parseEnvelope(env({ kind: 'request', type: 'future.thing', payload: {} })).ok).toBe(true)
  })

  it('accepts an error response without payload, rejects an unknown error code', () => {
    const ok = env({
      kind: 'response',
      type: 'api.save',
      payload: undefined,
      error: { code: 'conflict', message: 'x' },
    })
    expect(parseEnvelope(ok).ok).toBe(true)
    const bad = env({ kind: 'response', type: 'api.save', error: { code: 'teapot', message: 'x' } })
    expect(parseEnvelope(bad).ok).toBe(false)
  })

  it('tolerates unknown capability keys but not non-boolean values', () => {
    expect(isInitPayload({ ...init, capabilities: { future: true } })).toBe(true)
    expect(isInitPayload({ ...init, capabilities: { save: 'yes' } })).toBe(false)
    expect(isInitPayload({ ...init, apiMode: 'cookie' })).toBe(false)
  })

  it('checks file sources', () => {
    expect(isFileSource({ kind: 'url', url: 'https://x/y' })).toBe(true)
    expect(isFileSource({ kind: 'bytes', data: new ArrayBuffer(1) })).toBe(true)
    expect(isFileSource({ kind: 'bytes', data: [1, 2] })).toBe(false)
    expect(isFileSource({ kind: 'url', url: 'x', headers: { a: 1 } })).toBe(false)
  })
})

describe('error mapping', () => {
  it.each([
    [401, 'unauthorized', false],
    [403, 'forbidden', false],
    [404, 'not_found', false],
    [409, 'conflict', false],
    [412, 'conflict', false],
    [413, 'too_large', false],
    [429, 'rate_limited', true],
    [500, 'internal', true],
    [503, 'internal', true],
  ])('HTTP %i -> %s', (status, code, retryable) => {
    const e = errorFromHttpStatus(status)
    expect(e).toBeInstanceOf(DocsProtocolError)
    expect(e.toShape()).toEqual({ code, message: `HTTP ${status}`, status, retryable })
  })

  it('normalises thrown values', () => {
    expect(toProtocolError(new Error('boom')).code).toBe('internal')
    expect(toProtocolError(new TypeError('Failed to fetch')).code).toBe('network')
    expect(toProtocolError(Object.assign(new Error('x'), { name: 'AbortError' })).code).toBe(
      'cancelled',
    )
    expect(toProtocolError({ code: 'conflict', message: 'm' }).code).toBe('conflict')
    expect(toProtocolError({ code: 'busy', message: 'save running' }).code).toBe('busy')
    expect(toProtocolError('str').message).toBe('str')
    const pe = new DocsProtocolError({ code: 'timeout', message: 't' })
    expect(toProtocolError(pe)).toBe(pe)
  })
})

describe('additive fields (PROTOCOL_VERSION stays 1)', () => {
  const ready = (payload: Record<string, unknown>) =>
    parseEnvelope(
      env({ type: 'ready', payload: { protocolVersion: 1, capabilities: {}, ...payload } }),
    )

  it('ready.instanceId is optional and must be a string', () => {
    expect(ready({}).ok).toBe(true)
    expect(ready({ instanceId: 'abc123' }).ok).toBe(true)
    expect(ready({ instanceId: 42 })).toMatchObject({ ok: false, reason: 'malformed' })
  })

  it('a busy error and a filePick capability are valid on the wire', () => {
    const busy = parseEnvelope(
      env({ kind: 'response', type: 'save', error: { code: 'busy', message: 'save running' } }),
    )
    expect(busy).toMatchObject({ ok: true, message: { error: { code: 'busy' } } })
    expect(ready({ capabilities: { filePick: true, recents: false } }).ok).toBe(true)
  })
})
