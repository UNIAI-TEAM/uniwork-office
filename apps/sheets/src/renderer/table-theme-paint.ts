/**
 * A session table's Excel style rides on Univer's range theme, which composes
 * UNDER the cell's own style by key. Every cell read from a file carries a
 * complete xf, including an explicit empty fill (NO_FILL_STYLE) and bold off,
 * so the theme's fills and header bold never showed while its font color did:
 * a restyled Medium/Dark table came out as white text on no fill. File tables
 * avoid this by baking the palette into the cells at load; a session table has
 * no such pass, so the display-only interceptor below lets the theme win over
 * those two xf defaults. Real fills and fonts the user set stay on top, and
 * the stored xf is never touched, so saves and exports are unchanged.
 */
import {
  BooleanNumber,
  InterceptorEffectEnum,
  type IStyleData,
  type Nullable,
} from '@univerjs/core'
import { INTERCEPTOR_POINT, SheetInterceptorService, SheetRangeThemeModel } from '@univerjs/sheets'

import type { UniverRuntime } from './univer-state'

export function themedTableCellStyle(
  themeStyle: Nullable<IStyleData>,
  style: Nullable<IStyleData>,
): IStyleData | null {
  if (!themeStyle || !style) return null
  const themeFill = Boolean(themeStyle.bg?.rgb)
  const cellBlocksFill = style.bg !== undefined && !style.bg?.rgb
  const dropFill = themeFill && cellBlocksFill
  const dropBold = themeStyle.bl === BooleanNumber.TRUE && style.bl === BooleanNumber.FALSE
  if (!dropFill && !dropBold) return null
  const next: IStyleData = { ...style }
  if (dropFill) delete next.bg
  if (dropBold) delete next.bl
  return next
}

export function installTableThemePaint(runtime: UniverRuntime): { dispose(): void } {
  const injector = runtime.univer.__getInjector()
  const interceptorService = injector.get(SheetInterceptorService)
  const themeModel = injector.get(SheetRangeThemeModel)
  return interceptorService.intercept(INTERCEPTOR_POINT.CELL_CONTENT, {
    // Above the range-theme interceptor (0) so the rewritten style is the one
    // it composes under; the theme is looked up here because it has not yet
    // attached cell.themeStyle.
    priority: 1,
    effect: InterceptorEffectEnum.Style,
    handler: (cell, location, next) => {
      if (!cell) return next(cell)
      const themeStyle = themeModel.getCellStyle(
        location.unitId,
        location.subUnitId,
        location.row,
        location.col,
      )
      if (!themeStyle) return next(cell)
      const style = themedTableCellStyle(
        themeStyle,
        location.workbook.getStyles().getStyleByCell(cell),
      )
      return style === null ? next(cell) : next({ ...cell, s: style })
    },
  })
}
