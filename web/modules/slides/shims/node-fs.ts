/**
 * node:fs / node:stream/promises for the pptx engine in the Slides web frame (GO-B5).
 * The only importer is the desktop-only `savePptxToFile` (dynamic import); the web save path
 * is `savePptx` -> bytes -> `api.save`. The specifiers must still resolve at bundle time, so
 * both alias here and fail loudly if anything ever reaches them.
 */
function unavailable(): never {
  throw new Error('file streaming is not available in the web frame; save through savePptx')
}

export function createWriteStream(): never {
  return unavailable()
}

export async function pipeline(): Promise<never> {
  return unavailable()
}
