/** Session handlers: Tables, charts and SmartArt. */
import { editChartElement, getChartElementData } from '@genoffice/pptx-engine'
import { matchesElementRef } from '@genoffice/pptx-engine/identity'
import { EMU_PER_PX_96 } from '@genoffice/pptx-render'
import { tm } from '../../main/i18n-main'
import type {
  AddChartOp,
  AddSmartArtOp,
  AddTableOp,
  EditChartOp,
  EditTableCellOp,
  EditTableStyleOp,
  SetTableCellAnchorOp,
  SetTableColWidthOp,
  SetTableRowHeightOp,
  TableMergeIpcOp,
  TableStructureIpcOp,
} from '../../shared/ipc'
import { CHART_COLOR_SCHEMES, chartColorSchemes } from '../chart-colors'
import type { HandlerContext } from '../host-io'
import { rebuildSlide, rebuildSlideWithReparse } from '../render'
import { pushHistory, sessions } from '../state'
import { journaledTxn, sessionTxn } from '../txn'

export const tableChartHandlers = {
  'slides:add-table': (ctx: HandlerContext, op: AddTableOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    if (!session.opened.deck.slides[op.slideIndex]) return null
    const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
    const scale = op.fitWidthPx / baseWidthPx
    const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
    const rowH = op.rowHeightEmu && op.rowHeightEmu > 0 ? Math.round(op.rowHeightEmu) : null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'addTable',
          target: { slide: op.slideIndex },
          rows: op.rows,
          cols: op.cols,
          offset: {
            x: toEmu(op.xPx),
            y: toEmu(op.yPx),
            cx: toEmu(op.wPx),
            cy: rowH ? rowH * op.rows : toEmu(op.hPx),
          },
          ...(rowH ? { rowHeightsEmu: Array.from({ length: op.rows }, () => rowH) } : {}),
        },
      ],
    })
    if (!r) return null
    session.fitWidthPx = op.fitWidthPx
    const rebuilt = rebuildSlide(session, op.slideIndex)
    return rebuilt ? { slide: rebuilt, sourceId: r.records![0]!.created![0]! } : null
  },

  'slides:edit-table-cell': (ctx: HandlerContext, op: EditTableCellOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'setTableCell',
          target: { slide: op.slideIndex, el: op.sourceId },
          row: op.row,
          col: op.col,
          paragraphs: op.paragraphs,
        },
      ],
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  'slides:table-structure': (ctx: HandlerContext, op: TableStructureIpcOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'tableStructure',
          target: { slide: op.slideIndex, el: op.sourceId },
          kind: op.kind,
          index: op.index,
          ...(op.before ? { before: true } : {}),
        },
      ],
    })
    if (!r) return null
    const rebuilt = rebuildSlide(session, op.slideIndex)
    return rebuilt
      ? { slide: rebuilt, sourceId: (r.records![0]!.after as { elementId: string }).elementId }
      : null
  },

  'slides:table-merge': (ctx: HandlerContext, op: TableMergeIpcOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'tableMerge',
          target: { slide: op.slideIndex, el: op.sourceId },
          kind: op.kind,
          row: op.row,
          col: op.col,
        },
      ],
    })
    if (!r) return null
    const rebuilt = rebuildSlide(session, op.slideIndex)
    return rebuilt
      ? { slide: rebuilt, sourceId: (r.records![0]!.after as { elementId: string }).elementId }
      : null
  },

  'slides:set-table-col-width': (ctx: HandlerContext, op: SetTableColWidthOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
    const scale = op.fitWidthPx / baseWidthPx
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'setTableColWidth',
          target: { slide: op.slideIndex, el: op.sourceId },
          col: op.col,
          wEmu: (op.wPx / scale) * EMU_PER_PX_96,
        },
      ],
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  'slides:set-table-row-height': (ctx: HandlerContext, op: SetTableRowHeightOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
    const scale = op.fitWidthPx / baseWidthPx
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'setTableRowHeight',
          target: { slide: op.slideIndex, el: op.sourceId },
          row: op.row,
          hEmu: (op.hPx / scale) * EMU_PER_PX_96,
        },
      ],
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  'slides:set-table-cell-anchor': (ctx: HandlerContext, op: SetTableCellAnchorOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'setTableCellAnchor',
          target: { slide: op.slideIndex, el: op.sourceId },
          row: op.row,
          col: op.col,
          anchor: op.anchor,
        },
      ],
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  'slides:edit-table-style': (ctx: HandlerContext, op: EditTableStyleOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const slide = session.opened.deck.slides[op.slideIndex]
    if (!slide) return null
    // A reparse regenerates element ids: look up the new id by element index; the renderer uses it to keep the selection
    const elIdx = slide.elements.findIndex((el) => matchesElementRef(el, op.sourceId))
    pushHistory(session)
    const { slideIndex, sourceId, ...style } = op
    const r = journaledTxn(session, 'edit', {
      ops: [{ op: 'setTableStyle', target: { slide: slideIndex, el: sourceId }, ...style }],
    })
    if (!r.applied) {
      session.undoStack.pop()
      return null
    }
    // The patch is written on anchor.originalXml; a materialize reparse is needed before it shows in the render model
    const rebuilt = rebuildSlideWithReparse(session, op.slideIndex)
    if (!rebuilt) return null
    const newId = session.opened.deck.slides[op.slideIndex]?.elements[elIdx]?.id ?? null
    return { slide: rebuilt, sourceId: newId }
  },

  'slides:add-chart': (ctx: HandlerContext, op: AddChartOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session || !session.opened.deck.slides[op.slideIndex]) return null
    const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
    const scale = op.fitWidthPx / baseWidthPx
    const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'addChart',
          target: { slide: op.slideIndex },
          kind: op.kind === 'barH' ? 'bar' : op.kind,
          ...(op.kind === 'barH' ? { barDir: 'bar' as const } : {}),
          ...(op.title ? { title: op.title } : {}),
          categories: op.categories,
          series: op.series,
          offset: { x: toEmu(op.xPx), y: toEmu(op.yPx), cx: toEmu(op.wPx), cy: toEmu(op.hPx) },
        },
      ],
    })
    if (!r) return null
    session.fitWidthPx = op.fitWidthPx
    const rebuilt = rebuildSlide(session, op.slideIndex)
    return rebuilt ? { slide: rebuilt, sourceId: r.records![0]!.created![0]! } : null
  },

  'slides:get-chart-data': (ctx: HandlerContext, slideIndex: number, sourceId: string) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const slide = session.opened.deck.slides[slideIndex]
    if (!slide) return null
    return getChartElementData(slide, sourceId)
  },

  'slides:chart-color-schemes': (ctx: HandlerContext) => {
    const session = sessions.get(ctx.clientId)
    return session ? chartColorSchemes(session.opened) : null
  },

  'slides:edit-chart': async (ctx: HandlerContext, op: EditChartOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const slide = session.opened.deck.slides[op.slideIndex]
    if (!slide) return null
    // A reparse regenerates element ids: look up the new id by element index; the renderer uses it to keep the selection
    const elIdx = slide.elements.findIndex((el) => matchesElementRef(el, op.sourceId))
    // Confirm before the first edit of a chart from an imported file: editing rebuilds it from the template,
    // and unmodeled fine-grained formatting (number formats/trendlines/error bars/per-point styles) is lost
    const chartEl = slide.elements[elIdx] as { type?: string; descr?: string } | undefined
    if (chartEl?.type === 'chart' && chartEl.descr !== 'aislides-chart') {
      const response = await ctx.host.confirm({
        type: 'warning',
        buttons: [tm('chartSimplifyOk'), tm('btnCancel')],
        defaultId: 0,
        cancelId: 1,
        message: tm('chartSimplifyTitle'),
        detail: tm('chartSimplifyBody'),
      })
      if (response !== 0) return null
    }
    const patch: Parameters<typeof editChartElement>[3] = {
      ...(op.kind ? { kind: op.kind === 'barH' ? 'bar' : op.kind } : {}),
      ...(op.kind === 'barH' ? { barDir: 'bar' as const } : {}),
      ...(op.categories ? { categories: op.categories } : {}),
      ...(op.series ? { series: op.series } : {}),
      ...(op.title !== undefined ? { title: op.title } : {}),
      ...(op.colorScheme
        ? {
            colorScheme:
              chartColorSchemes(session.opened).find((s) => s.key === op.colorScheme)?.colors ??
              CHART_COLOR_SCHEMES[op.colorScheme],
          }
        : {}),
      ...(op.legendPos ? { legendPos: op.legendPos } : {}),
      ...(op.dataLabels !== undefined ? { dataLabels: op.dataLabels } : {}),
      ...(op.gridlines !== undefined ? { gridlines: op.gridlines } : {}),
      ...(op.catAxisTitle !== undefined ? { catAxisTitle: op.catAxisTitle } : {}),
      ...(op.valAxisTitle !== undefined ? { valAxisTitle: op.valAxisTitle } : {}),
      ...(op.gapWidthPct !== undefined ? { gapWidthPct: op.gapWidthPct } : {}),
      ...(op.switchRowCol ? { switchRowCol: true } : {}),
      ...(op.pointColors ? { pointColors: op.pointColors } : {}),
    }
    const r = sessionTxn(session, {
      ops: [{ op: 'setChart', target: { slide: op.slideIndex, el: op.sourceId }, patch }],
    })
    if (!r) return null
    // The chart part XML is updated; reparse the whole page to refresh the model
    const rebuilt = rebuildSlideWithReparse(session, op.slideIndex)
    if (!rebuilt) return null
    const newId = session.opened.deck.slides[op.slideIndex]?.elements[elIdx]?.id ?? null
    return { slide: rebuilt, sourceId: newId }
  },

  'slides:add-smartart': (ctx: HandlerContext, op: AddSmartArtOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session || !session.opened.deck.slides[op.slideIndex]) return null
    const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
    const scale = op.fitWidthPx / baseWidthPx
    const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'addSmartArt',
          target: { slide: op.slideIndex },
          layout: op.layout,
          items: op.items,
          offset: { x: toEmu(op.xPx), y: toEmu(op.yPx), cx: toEmu(op.wPx), cy: toEmu(op.hPx) },
        },
      ],
    })
    if (!r) return null
    session.fitWidthPx = op.fitWidthPx
    const rebuilt = rebuildSlide(session, op.slideIndex)
    return rebuilt ? { slide: rebuilt, sourceId: r.records![0]!.created![0]! } : null
  },
}
