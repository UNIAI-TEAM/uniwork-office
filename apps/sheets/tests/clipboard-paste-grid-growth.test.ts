// @vitest-environment jsdom
/**
 * UNI-1922 (RSG-2): a real clipboard paste through SheetClipboardService —
 * service.copy() + PasteCommand → SheetClipboardService.pasteByCopyId →
 * _pasteInternal — pasting a 1×2 block into a Z2:Z5 selection tiles it over
 * Z2:AA5, and Univer's pasting-columns hook grows the grid with an
 * InsertColMutation bundled into the paste's single undo entry.
 *
 * The headless rig registers the real SheetClipboardService and
 * SheetClipboardController (the pieces UniverSheetsUIPlugin would install)
 * on top of the usual sheets plugin; UI-only dependencies the controller
 * resolves are stubbed (no DOM surfaces in jsdom).
 */
import {
  ICommandService,
  IUndoRedoService,
  IUniverInstanceService,
  LocaleType,
  LogLevel,
  RANGE_TYPE,
  Univer,
} from '@univerjs/core'
import { FUniver } from '@univerjs/core/lib/facade'
import { UniverRenderEnginePlugin } from '@univerjs/engine-render'
import { SetSelectionsOperation, UniverSheetsPlugin } from '@univerjs/sheets'
import '@univerjs/sheets/facade'
import {
  IMarkSelectionService,
  ISheetClipboardService,
  SheetClipboardController,
  SheetClipboardService,
} from '@univerjs/sheets-ui'
import {
  IClipboardInterfaceService,
  IMessageService,
  INotificationService,
  IPlatformService,
  IUIPartsService,
  PasteCommand,
} from '@univerjs/ui'
import { Subject } from 'rxjs'
import { describe, expect, it } from 'vitest'

import { installClipboardAnchorTile } from '../src/renderer/clipboard-anchor-tile'
import type { UniverRuntime } from '../src/renderer/univer-state'

const UNIT_ID = 'sgrid-w3-paste-unit'
const SHEET_ID = 'sgrid-w3-paste-sheet'

describe('UNI-1922 RSG-2: real clipboard paste grows the grid past column Z', () => {
  it('select Z2:Z5, paste a 1x2 block: grid grows to >=27 columns, one undo removes the values', async () => {
    const univer = new Univer({
      logLevel: LogLevel.SILENT,
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: {} },
    })
    univer.registerPlugin(UniverRenderEnginePlugin)
    univer.registerPlugin(UniverSheetsPlugin)
    const univerAPI = FUniver.newAPI(univer)
    const injector = univer.__getInjector()

    // UI-layer services the clipboard service/controller resolve but that the
    // bare sheets rig does not provide (no DOM clipboard, toasts or popups).
    const disposableStub = { dispose: () => {} }
    injector.add([
      IClipboardInterfaceService,
      {
        useValue: {
          supportClipboard: false,
          read: async () => [],
          readText: async () => '',
          write: async () => {},
          writeText: async () => {},
        },
      },
    ])
    injector.add([
      IMarkSelectionService,
      {
        useValue: {
          addShape: () => null,
          addShapeWithNoFresh: () => null,
          removeShape: () => {},
          removeAllShapes: () => {},
          refreshShapes: () => {},
          getShapeMap: () => new Map(),
        },
      },
    ])
    injector.add([
      IPlatformService,
      { useValue: { isWindows: false, isMac: false, isLinux: true } },
    ])
    injector.add([INotificationService, { useValue: { show: () => disposableStub } }])
    injector.add([
      IMessageService,
      {
        useValue: {
          show: () => disposableStub,
          remove: () => {},
          removeAll: () => {},
        },
      },
    ])
    injector.add([
      IUIPartsService,
      {
        useValue: {
          componentRegistered$: new Subject<string>(),
          uiVisibleChange$: new Subject<{ ui: string; visible: boolean }>(),
          registerComponent: () => disposableStub,
          getComponents: () => new Set<never>(),
          setUIVisible: () => {},
          isUIVisible: () => false,
        },
      },
    ])
    injector.add([ISheetClipboardService, { useClass: SheetClipboardService }])

    univerAPI.createWorkbook({
      id: UNIT_ID,
      name: 'paste.xlsx',
      sheetOrder: [SHEET_ID],
      sheets: {
        [SHEET_ID]: { id: SHEET_ID, name: 'Data', rowCount: 1000, columnCount: 26 },
      },
    })
    injector.get(IUniverInstanceService).focusUnit(UNIT_ID)
    const workbook = univerAPI.getActiveWorkbook()!
    const worksheet = workbook.getActiveSheet()!
    const runtime = { univer, univerAPI } as unknown as UniverRuntime

    // Registers the copy/paste commands and the pasting rows/columns hooks,
    // exactly like UniverSheetsUIPlugin does in production.
    const controller = injector.createInstance(SheetClipboardController)
    installClipboardAnchorTile(runtime)

    const commandService = injector.get(ICommandService)
    const select = (startRow: number, endRow: number, startColumn: number, endColumn: number) => {
      const range = { startRow, endRow, startColumn, endColumn, rangeType: RANGE_TYPE.NORMAL }
      return commandService.syncExecuteCommand(SetSelectionsOperation.id, {
        unitId: UNIT_ID,
        subUnitId: SHEET_ID,
        selections: [{ range, primary: range }],
      })
    }

    // Source block A1:B1 (1×2), selected then copied through the service.
    worksheet.getRange('A1').setValue('x1')
    worksheet.getRange('B1').setValue('y1')
    select(0, 0, 0, 1)
    const clipboardService = injector.get(ISheetClipboardService)
    expect(await clipboardService.copy()).toBe(true)

    // Anchor-shaped target Z2:Z5 (one column, four rows — a whole multiple of
    // the source's height but narrower than its width): our hook widens the
    // selection to Z2:AA5, Univer's pasting-columns hook then appends an
    // InsertColMutation because column AA is past the 26-column grid.
    select(1, 4, 25, 25)
    expect(worksheet.getMaxColumns()).toBe(26)
    // Univer's LocalUndoRedoService stores per-unit stacks in _undoStacks
    const undoStacks = injector.get(IUndoRedoService) as unknown as {
      _undoStacks: Map<string, unknown[]>
    }
    const undoDepthBefore = undoStacks._undoStacks.get(UNIT_ID)?.length ?? 0

    expect(await commandService.executeCommand(PasteCommand.id)).toBe(true)
    expect(worksheet.getMaxColumns()).toBeGreaterThanOrEqual(27)
    // Tiled 1×2 block over Z2:AA5: x/y alternate per column, all four rows.
    expect(worksheet.getRange('Z2').getValue()).toBe('x1')
    expect(worksheet.getRange('AA2').getValue()).toBe('y1')
    expect(worksheet.getRange('Z5').getValue()).toBe('x1')
    expect(worksheet.getRange('AA5').getValue()).toBe('y1')

    // The paste is one undo entry (insert-cols + set-range-values together).
    const undoDepthAfter = undoStacks._undoStacks.get(UNIT_ID)?.length ?? 0
    expect(undoDepthAfter).toBe(undoDepthBefore + 1)

    await univerAPI.undo()
    // AA is past the grid again once undo removes the inserted column, so an
    // FRange there would throw — read the cell straight off the core model.
    const coreSheet = workbook.getWorkbook().getSheetBySheetId(SHEET_ID)
    expect(coreSheet?.getCellRaw(1, 25)?.v ?? null).toBeNull()
    expect(coreSheet?.getCellRaw(4, 26)?.v ?? null).toBeNull()

    controller.dispose()
  })
})
