/** Two fake windows wired like a page and its iframe, with browser-like postMessage semantics. */
import type { MessageSource, PostTarget } from '../endpoint'

type Listener = (ev: MessageEvent) => void

export class FakeWindow implements PostTarget, MessageSource {
  private readonly listeners = new Set<Listener>()
  /** messages this window posted, for assertions */
  readonly sent: unknown[] = []
  peer: FakeWindow | null = null

  constructor(readonly origin: string) {}

  addEventListener(_type: 'message', l: Listener): void {
    this.listeners.add(l)
  }
  removeEventListener(_type: 'message', l: Listener): void {
    this.listeners.delete(l)
  }

  /** Called on the *target* window by the sender, like `iframe.contentWindow.postMessage`. */
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void {
    const sender = this.peer
    if (!sender) throw new Error('no sender wired')
    sender.sent.push(message)
    // browsers silently drop when targetOrigin does not match the receiver
    if (targetOrigin !== '*' && targetOrigin !== this.origin) return
    const data = structuredClone(message, { transfer: transfer as Transferable[] | undefined })
    this.deliver(data, sender.origin, sender)
  }

  /** Inject a message as if `source` at `origin` posted it. */
  deliver(data: unknown, origin: string, source: unknown): void {
    const ev = { data, origin, source } as MessageEvent
    queueMicrotask(() => {
      for (const l of [...this.listeners]) l(ev)
    })
  }

  get listenerCount(): number {
    return this.listeners.size
  }
}

export const ORIGIN = 'https://app.uniwork.test'

/** host = the page, frame = iframe.contentWindow; same-origin by default. */
export function wirePair(
  hostOrigin = ORIGIN,
  frameOrigin = ORIGIN,
): { host: FakeWindow; frame: FakeWindow } {
  const host = new FakeWindow(hostOrigin)
  const frame = new FakeWindow(frameOrigin)
  host.peer = frame
  frame.peer = host
  return { host, frame }
}

/** Let queued microtasks (deliveries + promise chains) run. */
export async function flush(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
