import type { StringKey } from '../locale'
import type { NewDocKind } from '../uniwork-docs-model'

/**
 * UNI-1959: the pieces of the Documents home "New" menu and Quick create strip
 * that are data, not markup - the web's rows (documents-home-create.tsx), their
 * extension text and the web's default names.
 */

/** the menu's rows in the web's order; Folder is added in front inside an open folder */
export type NewMenuKind = NewDocKind | 'folder'

/** what each row shows on its right: the extension in mono, UniNote its "UniWork" tag */
export const NEW_KIND_EXT: Record<NewDocKind, string> = {
  page: 'UniWork',
  docx: '.docx',
  xlsx: '.xlsx',
  pptx: '.pptx',
  md: '.md',
  txt: '.txt',
  html: '.html',
  pdf: '.pdf',
}

/** the web's `documents.home.create.<type>.menu` names */
export const NEW_MENU_LABEL_KEY: Record<NewMenuKind, StringKey> = {
  page: 'uhNewMenuPage',
  docx: 'uhNewMenuDocx',
  xlsx: 'uhNewMenuXlsx',
  pptx: 'uhNewMenuPptx',
  md: 'uhNewMenuMd',
  txt: 'uhNewMenuTxt',
  html: 'uhNewMenuHtml',
  pdf: 'uhNewMenuPdf',
  folder: 'uhNewMenuFolder',
}

/** the web's `documents.home.default_names.*` (file kinds keep their extension), UniNote and folder included */
export const NEW_DEFAULT_NAME_KEY: Record<NewMenuKind, StringKey> = {
  page: 'uhDefaultNamePage',
  docx: 'uhDefaultNameDocx',
  xlsx: 'uhDefaultNameXlsx',
  pptx: 'uhDefaultNamePptx',
  md: 'uhDefaultNameMd',
  txt: 'uhDefaultNameTxt',
  html: 'uhDefaultNameHtml',
  pdf: 'uhDefaultNamePdf',
  folder: 'uhDefaultNameFolder',
}

/** the errors a create shows as themselves; every other failure reads the generic create_failed */
export const CREATE_SPECIFIC_ERRORS = [
  'forbidden',
  'not_signed_in',
  'session_expired',
  'quota_exceeded',
  'network',
  'timeout',
] as const
