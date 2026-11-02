import { describe, expect, it } from 'vitest'
import {
  MAX_RESPONSE_BODY_BYTES,
  jsonBodyInsteadOfSse,
  parseToolInput,
  sseDataEvents,
  sseLines,
} from '../src/protocols/shared'

describe('sseLines', () => {
  it('splits a stream into lines, including a trailing line with no newline', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: a\ndata: b\n'))
        controller.enqueue(encoder.encode('data: c')) // no trailing newline
        controller.close()
      },
    })
    const lines: string[] = []
    for await (const line of sseLines(body)) lines.push(line)
    expect(lines).toEqual(['data: a', 'data: b', 'data: c'])
  })
})

describe('sseDataEvents', () => {
  const collect = async (text: string): Promise<string[]> => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text))
        controller.close()
      },
    })
    const payloads: string[] = []
    for await (const ev of sseDataEvents(body)) payloads.push(ev.raw)
    return payloads
  }

  it('dispatches every event when the server separates them with a single newline', async () => {
    expect(await collect('data: {"a":1}\ndata: {"b":2}\ndata: [DONE]\n')).toEqual([
      '{"a":1}',
      '{"b":2}',
      '[DONE]',
    ])
  })

  it('dispatches every event when the server separates them with a blank line', async () => {
    expect(await collect('data: {"a":1}\n\ndata: {"b":2}\n\n')).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('joins a JSON body that one event split across data: lines', async () => {
    const [payload] = await collect('data: {"a":\ndata: 1}\n\n')
    expect(payload).toBe('{"a":\n1}')
    expect(JSON.parse(payload ?? '')).toEqual({ a: 1 })
  })

  it('emits a keep-alive after a split body on its own, on a newline-only stream', async () => {
    expect(await collect('data: {"a":\ndata: 1}\ndata: ping\ndata: {"b":2}\n')).toEqual([
      '{"a":\n1}',
      'ping',
      '{"b":2}',
    ])
  })

  it('carries the parsed body and leaves it undefined for non-JSON payloads', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"a":\ndata: 1}\n\ndata: ping\ndata: [DONE]\n'),
        )
        controller.close()
      },
    })
    const events = []
    for await (const ev of sseDataEvents(body)) events.push(ev)
    expect(events).toEqual([
      { raw: '{"a":\n1}', json: { a: 1 } },
      { raw: 'ping', json: undefined },
      { raw: '[DONE]', json: undefined },
    ])
  })

  it('joins a split body even when the stream has no blank line at all', async () => {
    expect(await collect('data: {"a":\ndata: 1}')).toEqual(['{"a":\n1}'])
  })

  it('delivers a terminator that never gets a trailing blank line', async () => {
    expect(await collect('data: {"a":1}\ndata: [DONE]')).toEqual(['{"a":1}', '[DONE]'])
  })

  // Server keeps the socket open after [DONE]; the consumer must be able to break out.
  it('hands [DONE] to a consumer that breaks on it, on an open stream', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"a":1}\ndata: [DONE]\n'))
      },
    })
    const seen: string[] = []
    for await (const ev of sseDataEvents(body)) {
      seen.push(ev.raw)
      if (ev.raw === '[DONE]') break
    }
    expect(seen).toEqual(['{"a":1}', '[DONE]'])
  })

  it('does not glue a non-JSON keep-alive onto the terminator', async () => {
    expect(await collect('data: ping\ndata: [DONE]\n')).toEqual(['ping', '[DONE]'])
  })
})

describe('non-SSE response body cap', () => {
  it('caps an oversized JSON body and cancels the read', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_RESPONSE_BODY_BYTES + 1))
      },
      cancel() {
        cancelled = true
      },
    })
    const response = new Response(body, { headers: { 'content-type': 'application/json' } })
    await expect(jsonBodyInsteadOfSse(response)).rejects.toThrow(/Response body exceeded/)
    expect(cancelled).toBe(true)
  })
})

describe('jsonBodyInsteadOfSse', () => {
  it('detects JSON bodies regardless of Content-Type casing', async () => {
    const payload = JSON.stringify({ choices: [] })
    for (const contentType of [
      'application/json',
      'Application/JSON',
      'APPLICATION/JSON; charset=utf-8',
      'Application/Json; charset=utf-8',
    ]) {
      const res = new Response(payload, { status: 200, headers: { 'content-type': contentType } })
      await expect(jsonBodyInsteadOfSse(res)).resolves.toBe(payload)
    }
    const sse = new Response('data: hi\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
    await expect(jsonBodyInsteadOfSse(sse)).resolves.toBeNull()
  })
})

describe('parseToolInput', () => {
  it('rejects non-object JSON through the inputError channel (genoffice#1106)', () => {
    for (const raw of ['null', '[]', '42', '"x"', 'true']) {
      const r = parseToolInput(raw)
      expect(r.input).toEqual({})
      expect(r.error).toMatch(/must be a JSON object/)
    }
    expect(parseToolInput('{"a":1}')).toEqual({ input: { a: 1 } })
    expect(parseToolInput('')).toEqual({ input: {} })
  })
})
