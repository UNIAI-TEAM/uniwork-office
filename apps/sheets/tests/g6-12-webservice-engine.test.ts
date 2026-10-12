/**
 * §6.3 (b) evidence: does the formula engine in this app execute WEBSERVICE /
 * FILTERXML, and can a formula open a network connection? Runs the real
 * Univer formula engine (the one the sheets renderer uses) with every
 * network entry point stubbed, so any attempt is recorded.
 */
import { LocaleType, LogLevel, Univer, UniverInstanceType } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { IFunctionService, UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import '@univerjs/sheets/facade'
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula'
import '@univerjs/sheets-formula/facade'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { installSupportedFunctionProbe } from '../src/renderer/function-registry-probe'
import type { UniverRuntime } from '../src/renderer/univer-state'
import { setSupportedFunctionProbe, unsupportedFunctionNames } from '../src/renderer/univer-sync'

const FORMULAS: [cell: string, formula: string, expected: unknown][] = [
  ['A1', '=WEBSERVICE("https://example.invalid/rates?x=1")', '#NAME?'],
  ['A2', '=FILTERXML("<r><v>42</v></r>","//v")', '#NAME?'],
  ['A3', '=FILTERXML(WEBSERVICE("https://example.invalid/feed.xml"),"//v")', '#NAME?'],
  ['A4', '=IFERROR(WEBSERVICE("https://example.invalid/y"),"no network")', 'no network'],
  // control: the engine is live and evaluates the web function it does ship
  ['A5', '=ENCODEURL("a b")', 'a%20b'],
]

const network = {
  fetch: vi.fn(() => Promise.reject(new Error('network blocked by test'))),
  xhrOpen: vi.fn(),
  xhrSend: vi.fn(),
  webSocket: vi.fn(),
  beacon: vi.fn(() => false),
}

class RecordingXhr {
  open(...args: unknown[]): void {
    network.xhrOpen(...args)
  }
  send(...args: unknown[]): void {
    network.xhrSend(...args)
  }
  setRequestHeader(): void {}
  abort(): void {}
  addEventListener(): void {}
}

class RecordingWebSocket {
  constructor(...args: unknown[]) {
    network.webSocket(...args)
  }
}

describe('g6-12: WEBSERVICE / FILTERXML in the formula engine', () => {
  let univer: Univer
  let api: FUniver

  beforeAll(async () => {
    vi.stubGlobal('fetch', network.fetch)
    vi.stubGlobal('XMLHttpRequest', RecordingXhr)
    vi.stubGlobal('WebSocket', RecordingWebSocket)
    vi.stubGlobal('navigator', { ...globalThis.navigator, sendBeacon: network.beacon })
    univer = new Univer({ locale: LocaleType.EN_US, locales: {}, logLevel: LogLevel.ERROR })
    univer.registerPlugin(UniverFormulaEnginePlugin)
    univer.registerPlugin(UniverSheetsPlugin)
    univer.registerPlugin(UniverSheetsFormulaPlugin)
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, {
      id: 'wb',
      sheetOrder: ['s1'],
      sheets: { s1: { id: 's1', name: 'Data', rowCount: 20, columnCount: 5, cellData: {} } },
    })
    api = FUniver.newAPI(univer)
    const sheet = api.getActiveWorkbook()!.getSheetBySheetId('s1')!
    for (const [cell, formula] of FORMULAS) sheet.getRange(cell).setFormula(formula)
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }, 30_000)

  afterAll(() => {
    setSupportedFunctionProbe(null)
    univer.dispose()
    vi.unstubAllGlobals()
  })

  it('has no executor for WEBSERVICE or FILTERXML', () => {
    const functions = univer.__getInjector().get(IFunctionService)
    expect(functions.hasExecutor('WEBSERVICE')).toBe(false)
    expect(functions.hasExecutor('FILTERXML')).toBe(false)
    expect(functions.hasExecutor('ENCODEURL')).toBe(true)
  })

  it.each(FORMULAS)('%s %s evaluates to %j', (cell, _formula, expected) => {
    const value = api.getActiveWorkbook()!.getSheetBySheetId('s1')!.getRange(cell).getCellData()?.v
    expect(value).toBe(expected)
  })

  it('never touches the network', () => {
    expect(network.fetch).not.toHaveBeenCalled()
    expect(network.xhrOpen).not.toHaveBeenCalled()
    expect(network.xhrSend).not.toHaveBeenCalled()
    expect(network.webSocket).not.toHaveBeenCalled()
    expect(network.beacon).not.toHaveBeenCalled()
  })

  it('the AI read tools name them as unsupported functions', () => {
    installSupportedFunctionProbe({ univer } as unknown as UniverRuntime)
    expect(unsupportedFunctionNames(FORMULAS[2]![1])).toEqual(['FILTERXML', 'WEBSERVICE'])
  })
})
