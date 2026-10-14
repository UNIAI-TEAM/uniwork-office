import { describe, expect, it, vi } from 'vitest'
import {
  AgentLoop,
  createAiRunTracker,
  createIpcTransport,
  type AgentMessage,
  type AgentSkill,
  type IpcStreamChunk,
} from '@genoffice/agent-core'
import type { AiStreamChunk, AiStreamRequest, UniworkChatRequest } from '@genoffice/ai-provider'
import { defaultAiSettings, streamUniwork } from '@genoffice/ai-provider'
import { createUniworkAiStreams, type UniworkAiStreamDeps } from '../src/main/uniwork-auth/ai-chat'

/**
 * G05BE-2: the loop's context-summary call and the one-shot writers
 * (streamText) are not agent turns. UniWork AI keeps the conversation on the
 * server and takes only the user's question, so the runner answers them with
 * `unsupported` before any request; the loop then folds old turns into its
 * mechanical digest.
 */

const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const ORG = '01J8X4ORG0N1P2Q3R4S5T6U7'
const SUMMARY_ASK = 'Compress the conversation above as instructed.'

function answer(text: string): Response {
  const chunk = {
    choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }],
    x_uniwork: { step: 0, limit: 8 },
  }
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'X-UniWork-AI-Conversation': 'conv-1',
      'X-UniWork-AI-Run': 'run-1',
    },
  })
}

function server() {
  const state = { nextAnswer: 'Done.' }
  const bodies: string[] = []
  const post = vi.fn(async (req: UniworkChatRequest) => {
    bodies.push(req.body)
    const text = state.nextAnswer
    state.nextAnswer = 'Done.'
    return answer(text)
  })
  return {
    bodies,
    post,
    set nextAnswer(text: string) {
      state.nextAnswer = text
    },
  }
}

function streams(post: UniworkAiStreamDeps['transport'] extends () => infer T ? T : never) {
  return createUniworkAiStreams({
    transport: () => post,
    scope: () => ({
      ok: true,
      scope: { kind: 'document', documentId: DOC, format: 'docx' },
      orgId: ORG,
    }),
    available: async () => true,
    toolPolicy: () => ({ cloudTools: false }),
    stream: streamUniwork,
  })
}

function request(over: Partial<AiStreamRequest>): AiStreamRequest {
  return {
    requestId: 'req-1',
    sessionId: 'sess-1',
    settings: { ...defaultAiSettings(), provider: 'uniwork' },
    system: 'sys',
    messages: [{ role: 'user', text: SUMMARY_ASK }],
    tools: [],
    ...over,
  }
}

describe('ai:stream uniwork runner: non-agent requests', () => {
  it.each(['summary', 'one-shot'] as const)(
    'purpose %s ends with an unsupported error before any request',
    async (purpose) => {
      const fake = server()
      const runner = streams(fake)
      const chunks: AiStreamChunk[] = []
      await runner.run({
        senderId: 7,
        request: request({ purpose }),
        send: (c) => chunks.push(c),
        signal: new AbortController().signal,
      })
      expect(fake.post).not.toHaveBeenCalled()
      expect(runner.active()).toBe(0)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toMatchObject({ type: 'error', uniworkCode: 'unsupported' })
    },
  )

  it('an agent turn (no purpose) still goes out', async () => {
    const fake = server()
    const chunks: AiStreamChunk[] = []
    await streams(fake).run({
      senderId: 7,
      request: request({ messages: [{ role: 'user', text: 'make it bold' }] }),
      send: (c) => chunks.push(c),
      signal: new AbortController().signal,
    })
    expect(fake.post).toHaveBeenCalledTimes(1)
    expect(chunks.at(-1)).toMatchObject({ type: 'done' })
  })
})

describe('AgentLoop over UniWork AI: history over 256 KiB', () => {
  it('the summary request never reaches the server; the loop folds old turns mechanically', async () => {
    const fake = server()
    const runner = streams(fake)
    // the renderer's IPC transport wired straight into the main-process runner
    let listener: ((chunk: IpcStreamChunk) => void) | null = null
    const transport = createIpcTransport({
      onStream: (l) => {
        listener = l
        return () => {
          listener = null
        }
      },
      start: (req) =>
        runner.run({
          senderId: 7,
          request: req as AiStreamRequest,
          send: (chunk) => listener?.(chunk as IpcStreamChunk),
          signal: new AbortController().signal,
        }),
      cancel: () => undefined,
      getSettings: () => ({ ...defaultAiSettings(), provider: 'uniwork' }),
      unknownErrorText: () => 'unknown',
      aiRun: createAiRunTracker(),
    })
    const skill: AgentSkill = {
      id: 'docs',
      systemPrompt: 'system',
      tools: [],
      buildContext: () => '',
      executeTool: () => ({ output: 'ok', summary: 'ok' }),
    }
    let finished: () => void = () => undefined
    const loop = new AgentLoop({ transport, skill, events: { onDone: () => finished() } })
    const ask = (text: string) =>
      new Promise<void>((resolve) => {
        finished = resolve
        loop.run(text)
      })
    // restored just under the 256 KiB budget (restore folds anything over it without a request)
    const big = 'x'.repeat(40 * 1024)
    const history: AgentMessage[] = []
    for (let i = 0; i < 6; i++) {
      history.push({ role: 'user', text: `old question ${i} ${big}` })
      history.push({ role: 'assistant', text: `old answer ${i}` })
    }
    loop.restore(history)
    // a long answer pushes the history over the budget: the next question compacts first
    fake.nextAnswer = 'y'.repeat(24 * 1024)
    await ask('first question')
    await ask('second question')
    expect(fake.bodies.some((b) => b.includes(SUMMARY_ASK))).toBe(false)
    expect(fake.bodies.map((b) => JSON.parse(b).messages)).toEqual([
      [{ role: 'user', content: 'first question' }],
      [{ role: 'user', content: 'second question' }],
    ])
    // compacted all the same, by the mechanical digest
    expect(loop.messages.length).toBeLessThan(history.length)
  })
})
