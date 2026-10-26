// `node --require <this file> script.cjs`: every attempt to reach the network is
// appended to $NET_ATTEMPTS_FILE and then throws. Passed as a CLI flag it is part
// of execArgv, which worker threads (tesseract.js runs recognition in one)
// inherit; the file path travels in the environment, which they share too.
'use strict'

const fs = require('node:fs')

function trip(what) {
  const file = process.env.NET_ATTEMPTS_FILE
  if (file) {
    try {
      fs.appendFileSync(file, `${what}\n`)
    } catch {
      // the throw below is the point
    }
  }
  throw new Error(`network attempt: ${what}`)
}

const guarded = {
  net: ['connect', 'createConnection'],
  tls: ['connect'],
  http: ['request', 'get'],
  https: ['request', 'get'],
  dns: ['lookup', 'resolve', 'resolve4', 'resolve6'],
}
for (const [name, fns] of Object.entries(guarded)) {
  const mod = require(`node:${name}`)
  for (const fn of fns) mod[fn] = () => trip(`${name}.${fn}`)
}
require('node:dns').promises.lookup = () => trip('dns.promises.lookup')
require('node:net').Socket.prototype.connect = () => trip('net.Socket.connect')
globalThis.fetch = () => trip('fetch')
