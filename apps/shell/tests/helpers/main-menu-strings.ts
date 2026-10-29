import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createI18n, type Lang } from '@genoffice/i18n'
import type { TabMenuStringKey } from '../../src/main/tab-menu'

function extractCallTable(
  fileUrl: URL,
  varName: string,
  label: string,
): Record<Lang, Record<string, string>> {
  const source = ts.createSourceFile(
    fileUrl.pathname,
    readFileSync(fileUrl, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  let table: ts.Expression | undefined
  function findTable(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === varName &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      table = node.initializer.arguments[0]
    ts.forEachChild(node, findTable)
  }
  findTable(source)
  if (!table || !ts.isObjectLiteralExpression(table))
    throw new Error(`${label} string table missing`)
  return runInNewContext(`(${table.getText(source)})`) as Record<Lang, Record<string, string>>
}

// Read the production tables without importing index.ts and starting Electron.
const tabShard = extractCallTable(
  new URL('../../src/main/tab-menu-strings.ts', import.meta.url),
  'tabMenuStrings',
  'Shell tab menu',
)
const mainTable = extractCallTable(
  new URL('../../src/main/index.ts', import.meta.url),
  'tMain',
  'Shell main',
)

export const mainMenuStrings = Object.fromEntries(
  (Object.keys(tabShard) as Lang[]).map((lang) => [
    lang,
    {
      ...tabShard[lang],
      ...(mainTable[lang]?.menuOpenInNewWindow
        ? { menuOpenInNewWindow: mainTable[lang].menuOpenInNewWindow }
        : {}),
      ...(mainTable[lang]?.menuClose ? { menuClose: mainTable[lang].menuClose } : {}),
    },
  ]),
) as Record<Lang, Record<TabMenuStringKey, string>>
export const translateMainMenu = createI18n(mainMenuStrings)
export const tm = (key: TabMenuStringKey): string => translateMainMenu('en', key)
