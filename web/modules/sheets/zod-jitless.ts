/**
 * zod v4 probes `new Function("")` once, while the first object schema is *constructed*, to
 * decide on its JIT parsers. Under the frame's script-src (no 'unsafe-eval') that probe is a CSP
 * violation report. jitless skips the probe and the eval-based fast path (the CSP would block it
 * anyway). ES modules evaluate in import order, so ./install.ts imports this module first: the
 * engine transport imports the desktop-api schemas, which are constructed at module evaluation.
 */
import { config } from 'zod'

config({ jitless: true })
