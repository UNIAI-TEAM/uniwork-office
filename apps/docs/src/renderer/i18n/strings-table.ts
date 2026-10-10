import { defineStrings } from '@genoffice/i18n'

const en = {
  ribbonTableStyleOptions: 'Table Style Options',
  ribbonTableFirstRow: 'Header Row',
  ribbonTableLastRow: 'Total Row',
  ribbonTableBandedRows: 'Banded Rows',
  ribbonTableFirstColumn: 'First Column',
  ribbonTableLastColumn: 'Last Column',
  ribbonTableBandedColumns: 'Banded Columns',
  ribbonTablePresetGrid: 'Plain Grid',
  ribbonTablePresetBlueHeader: 'Blue Header',
  ribbonTablePresetBlueBanded: 'Blue Banded',
  ribbonTablePresetGrayBanded: 'Gray Banded',
  ribbonTablePresetGreenHeader: 'Green Header',
  ribbonAutoFit: 'AutoFit',
  ribbonAutoFitContents: 'AutoFit Contents',
  ribbonAutoFitWindow: 'AutoFit Window',
  ribbonFixedColumnWidth: 'Fixed Column Width',
  ribbonRepeatHeaderRows: 'Repeat Header Rows',
  ribbonTableProperties: 'Table Properties',
  ribbonTableData: 'Table',
  ribbonHorizontalPosition: 'Horizontal position',
  ribbonVerticalPosition: 'Vertical position',
  ribbonDistanceFromText: 'Distance from text',
  ribbonCellMargins: 'Default cell margins',
}

/** Vietnamese is reviewed for the UniWork web (the Table Design tab was English in vi). */
const vi: Record<keyof typeof en, string> = {
  ribbonTableStyleOptions: 'Tùy chọn kiểu bảng',
  ribbonTableFirstRow: 'Hàng tiêu đề',
  ribbonTableLastRow: 'Hàng tổng',
  ribbonTableBandedRows: 'Hàng xen kẽ',
  ribbonTableFirstColumn: 'Cột đầu',
  ribbonTableLastColumn: 'Cột cuối',
  ribbonTableBandedColumns: 'Cột xen kẽ',
  ribbonTablePresetGrid: 'Lưới đơn giản',
  ribbonTablePresetBlueHeader: 'Tiêu đề xanh dương',
  ribbonTablePresetBlueBanded: 'Xen kẽ xanh dương',
  ribbonTablePresetGrayBanded: 'Xen kẽ xám',
  ribbonTablePresetGreenHeader: 'Tiêu đề xanh lá',
  ribbonAutoFit: 'Tự khớp',
  ribbonAutoFitContents: 'Tự khớp theo nội dung',
  ribbonAutoFitWindow: 'Tự khớp theo cửa sổ',
  ribbonFixedColumnWidth: 'Độ rộng cột cố định',
  ribbonRepeatHeaderRows: 'Lặp lại hàng tiêu đề',
  ribbonTableProperties: 'Thuộc tính bảng',
  ribbonTableData: 'Bảng',
  ribbonHorizontalPosition: 'Vị trí ngang',
  ribbonVerticalPosition: 'Vị trí dọc',
  ribbonDistanceFromText: 'Khoảng cách đến văn bản',
  ribbonCellMargins: 'Lề ô mặc định',
}

/**
 * New table controls deliberately fall back to English until each locale has
 * reviewed terminology (vi is reviewed). Keeping one complete key set prevents
 * partially translated dialogs and lets language packs override the shard incrementally.
 */
export const tableStrings = defineStrings({
  zh: en,
  en,
  ja: en,
  ko: en,
  fr: en,
  de: en,
  es: en,
  th: en,
  id: en,
  ru: en,
  ar: en,
  pt: en,
  it: en,
  pl: en,
  cs: en,
  nl: en,
  ms: en,
  he: en,
  hi: en,
  'zh-TW': en,
  vi,
})
