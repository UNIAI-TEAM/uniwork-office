// common shortcut table. The block between the @generated markers is written
// by scripts/gen-tables.mjs from tests/fixtures/shortcuts.csv: change the CSV and
// regenerate, or put hand-maintained rows in `manual` below.
import { mergeRows } from '../table'
import type { ShortcutAction, UnmappedShortcut } from '../types'

// @generated-begin
const generated: readonly ShortcutAction[] = [
  // Open file
  {
    id: 'common-03',
    scope: 'common',
    win: ['Ctrl+O'],
    mac: ['Cmd+O'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: {},
  },
  // Save
  {
    id: 'common-04',
    scope: 'common',
    win: ['Ctrl+S'],
    mac: ['Cmd+S'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: {},
  },
  // Print
  {
    id: 'common-06',
    scope: 'common',
    win: ['Ctrl+P'],
    mac: ['Cmd+P'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: {},
  },
  // Expand / collapse the ribbon
  {
    id: 'common-10',
    scope: 'common',
    win: ['Ctrl+F1'],
    mac: ['Alt+Cmd+R'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: {},
  },
  // Keyboard shortcut sheet (Ctrl+/)
  {
    id: 'common-14',
    scope: 'common',
    win: [],
    mac: [],
    web: { win: ['Alt+Shift+A'], mac: [] },
    match: 'key',
    guard: {},
  },
  // Tell Me / Search the ribbon (Alt+Q)
  {
    id: 'common-15',
    scope: 'common',
    win: ['Alt+Q'],
    mac: [],
    match: 'key',
    guard: {},
  },
]

export const commonUnmapped: readonly UnmappedShortcut[] = [
  {
    id: 'common-01',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Ctrl+N / Cmd+N on the New item of every module menu (Excel Mac prints Cmd+N or Ctrl+N; Docs already same)"; web: proposal has prose: "no key: Ctrl+N / Cmd+N stay the browser\'s new window (Chromium reserved); New = menu item / button, MS web route is the address-bar URL Word.new / Excel.new / PowerPoint.new (ppt.new)"',
  },
  {
    id: 'common-02',
    part: 'desktop',
    reason:
      'proposal has prose: "KEEP only if Word "Apply the Normal style" Ctrl+Shift+N (Word 95ef... L1357) is not given to the editor; else move New window to menu only. Decision with S-docs"',
  },
  {
    id: 'common-02',
    part: 'web.win',
    reason: 'the browser keeps the Microsoft key',
  },
  {
    id: 'common-02',
    part: 'row',
    reason: 'no chord left on any platform',
  },
  {
    id: 'common-03',
    part: 'web',
    reason:
      'proposal has prose: "Ctrl+O / Cmd+O handled by the page only where UniWork has an Open action (preventDefault, as Excel web \'Override browser shortcuts\' ON); elsewhere no-op with preventDefault; mac from desktop, web page has no Mac column"',
  },
  {
    id: 'common-04',
    part: 'web',
    reason:
      'proposal has prose: "Ctrl+S / Cmd+S (preventDefault in frame; keep frame focus after dialogs); PowerPoint web autosaves and prints no key"',
  },
  {
    id: 'common-05',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Docs and Sheets: F12 (Windows) and Shift+Cmd+S (Mac); Docs must free Ctrl+Shift+S for Word "Apply Styles"; Slides/PDF/Markdown/HTML: Ctrl+Shift+S unchanged"; web: proposal has prose: "Docs: F12 / Cmd+Shift+S [DESKTOP-FALLBACK; D8: test F12 in browsers, replace if DevTools wins] | Sheets: Alt+F2 / not documented [MS-WEB win; Mac"',
  },
  {
    id: 'common-06',
    part: 'web',
    reason:
      'proposal has prose: "Ctrl+P / Cmd+P (preventDefault so the browser does not print the host page); mac from desktop for Word/Excel, web page has no Mac column; PowerPoint web prints Cmd+P"',
  },
  {
    id: 'common-07',
    part: 'row',
    reason:
      'desktop: proposal is conditional: "Windows Ctrl+W (Word, Excel); PowerPoint Windows page prints Ctrl+D (low confidence, see notes) so KEEP Ctrl+W; Mac: KEEP Cmd+W (Excel, PowerPoint print Cmd+W; Word Mac prints Cmd+F4, add it as hidden alias only if stage 2 confirms)"; web: proposal has prose: "Ctrl+W / Cmd+W stay the browser\'s close tab (MS: \'press Ctrl+W to close the browser tab\'); in-app Close item: Alt+Shift+W / not documented [Mac"',
  },
  {
    id: 'common-08',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Windows: add Ctrl+Q only for PowerPoint-parity if stage 2 wants it (Word/Excel Windows pages do not document a quit key); macOS Cmd+Q already same"; web: proposal has prose: "KEEP none (browser owns it; Chromium reserves IDC_EXIT)"',
  },
  {
    id: 'common-09',
    part: 'row',
    reason:
      'desktop: proposal has prose: "F6 / Shift+F6 exactly as MS (region list per module: ribbon, document, side pane, status bar)"; web: proposal has prose: "Ctrl+F6 / Shift+Ctrl+F6 inside each frame (preventDefault) / Cmd+F6 / Shift+Cmd+F6"',
  },
  {
    id: 'common-10',
    part: 'web',
    reason:
      'proposal has prose: "Docs: Ctrl+F3 / not documented [MS-WEB win; Mac desktop Mac prints none]"',
  },
  {
    id: 'common-10',
    part: 'web.win',
    reason:
      'ALT-PROPOSED without a single chord: "suggestion Cmd+Option+R = desktop Word Mac] | Sheets: Ctrl+F"',
  },
  {
    id: 'common-11',
    part: 'row',
    reason:
      'desktop: proposal has prose: "drop or move; Word Ctrl+Alt+K is "Enable AutoFormat" (word L1353)"; web: proposal has prose: "KEEP existing as menu item only: no shortcut (Ctrl+Alt is AltGr on many layouts)"',
  },
  {
    id: 'common-12',
    part: 'row',
    reason:
      'desktop: proposal is conditional: "KEEP Alt reveals the menu bar for now; ribbon key tips would need Alt to move to the ribbon (decision with S-table)"; web: proposal is conditional: "Backlog (access keys not in scope for stage 2). Target when built: Docs Alt+Period / Control+Period; Sheets Alt+Windows logo key (unreachable for a page) / Control+Option; Slides Alt+Period / Ctrl+Period; Alt alone must not be swallowed"',
  },
  {
    id: 'common-13',
    part: 'row',
    reason:
      'desktop: proposal has prose: "F1 opens the in-app help / shortcut sheet"; web: proposal has prose: "F1 intercepted in frames to open UniWork help (like Excel web \'Override browser shortcuts\' ON); also Alt+Shift+A (common-14); Word/PowerPoint web leave F1 to the browser / not documented"',
  },
  {
    id: 'common-14',
    part: 'desktop',
    reason:
      'proposal has prose: "Cmd+/ on Mac matches Excel for Mac; Windows: MS does not document Ctrl+/, so KEEP as UniWork-wide convention"',
  },
  {
    id: 'common-14',
    part: 'web.mac',
    reason: 'mac: no web chord (not documented)',
  },
  {
    id: 'common-15',
    part: 'web.mac',
    reason: 'mac: no web chord (not documented)',
  },
  {
    id: 'common-15',
    part: 'desktop.mac',
    reason: 'no mac chord in proposal_desktop',
  },
  {
    id: 'common-16',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Word, PowerPoint: Ctrl+Plus / Cmd+Plus (menu accelerator = unshifted = key, already close). Sheets: Excel zoom is Ctrl+Alt+=; our Ctrl+Alt+= scales the interface, so use another chord for interface scale"; web: proposal has prose: "Docs, Slides: Ctrl++ / Cmd++ where the frame has in-app zoom (browser zoom otherwise) | Sheets: KEEP existing zoom (Excel Ctrl+Alt+= not proposed: AltGr)"',
  },
  {
    id: 'common-17',
    part: 'row',
    reason:
      'desktop: proposal has prose: "as common-16; Sheets keeps Ctrl+- for Delete cells (Excel row), zoom via Ctrl+Alt+-"; web: proposal has prose: "Docs, Slides: Ctrl+- / Cmd+- where the frame has in-app zoom | Sheets: KEEP existing zoom (Excel Ctrl+Alt+- not proposed: AltGr)"',
  },
  {
    id: 'common-18',
    part: 'row',
    reason:
      'desktop: same as web, and web is unmapped; web: proposal has prose: "Docs: Ctrl+0 / Cmd+0 = 100% [DESKTOP-FALLBACK] | PDF: Ctrl+0 = 100% (Edge), fit-width on Ctrl+\\ | Sheets: KEEP Ctrl+0 = Hide columns (Excel web prints it)"',
  },
  {
    id: 'common-19',
    part: 'row',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'common-20',
    part: 'desktop',
    reason:
      'proposal has prose: "F11 (Edge) / Cmd+Ctrl+F; PowerPoint Windows page prints Ctrl+F1 for full screen but also for the ribbon, so do not copy it (open question)"',
  },
  {
    id: 'common-20',
    part: 'web.win',
    reason: 'the browser keeps the Microsoft key',
  },
  {
    id: 'common-20',
    part: 'row',
    reason: 'no chord left on any platform',
  },
  {
    id: 'common-21',
    part: 'desktop',
    reason:
      'proposal is conditional: "F12 and Ctrl+Shift+I identical in dev and packaged builds for all modules, or remove everywhere in packaged builds (product decision: Slides always-on is the outlier)"',
  },
  {
    id: 'common-21',
    part: 'web.win',
    reason: 'the browser keeps the Microsoft key',
  },
  {
    id: 'common-21',
    part: 'row',
    reason: 'no chord left on any platform',
  },
  {
    id: 'common-22',
    part: 'desktop',
    reason:
      'proposal has prose: "KEEP no reload in packaged builds (Cmd+R is Fill Right in Excel Mac, so it must not reload a Sheets tab)"',
  },
  {
    id: 'common-22',
    part: 'web.win',
    reason: 'the browser keeps the Microsoft key',
  },
  {
    id: 'common-22',
    part: 'row',
    reason: 'no chord left on any platform',
  },
  {
    id: 'common-dialog-keys',
    part: 'row',
    reason:
      'desktop: proposal has prose: "same"; web: proposal has prose: "KEEP Esc / Enter; add isComposing / keyCode 229 guards to every Enter-confirm handler"',
  },
]
// @generated-end

/** Hand-maintained rows: an entry with a generated id replaces that row. */
const manual: readonly ShortcutAction[] = []

export const commonShortcuts: readonly ShortcutAction[] = mergeRows(generated, manual)
