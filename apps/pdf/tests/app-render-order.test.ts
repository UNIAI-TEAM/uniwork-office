// @vitest-environment node
/**
 * The editor white-screened when OCR results arrived: the ocrBakeAll useMemo read pageGeomRef, a
 * const declared further down the component (temporal dead zone, thrown on the first render with
 * recognized pages). tsc only flags a synchronous use before its declaration, not one inside a
 * useMemo callback, and the App is too big to mount in jsdom, so the order is checked from the
 * source: nothing that runs during render (useMemo/useState/useReducer/useRef callbacks and
 * arguments, hook dependency arrays) may read a component-level const declared later.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const APP_PATH = fileURLToPath(new URL('../src/renderer/App.tsx', import.meta.url))

// callbacks of these hooks run synchronously while the component renders
const RENDER_TIME_CALLBACK = new Set(['useMemo', 'useState', 'useReducer', 'useRef'])
const HOOKS = new Set([...RENDER_TIME_CALLBACK, 'useCallback', 'useEffect', 'useLayoutEffect'])

function declaredNames(name: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(name)) out.push(name.text)
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) declaredNames(el.name, out)
}

function identifiersIn(node: ts.Node, out: ts.Identifier[] = []): ts.Identifier[] {
  if (ts.isIdentifier(node)) out.push(node)
  node.forEachChild((child) => {
    identifiersIn(child, out)
  })
  return out
}

/** render-time reads of a component-level const that is declared after the read */
export function renderTimeUseBeforeDeclaration(source: string): string[] {
  const file = ts.createSourceFile(
    'App.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const problems: string[] = []
  const lineOf = (pos: number) => file.getLineAndCharacterOfPosition(pos).line + 1

  const checkComponent = (body: ts.Block) => {
    const declaredAt = new Map<string, number>()
    for (const st of body.statements) {
      if (!ts.isVariableStatement(st)) continue
      for (const decl of st.declarationList.declarations) {
        const names: string[] = []
        declaredNames(decl.name, names)
        for (const n of names) declaredAt.set(n, st.getStart())
      }
    }
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOKS.has(n.expression.text)) {
        const hook = n.expression.text
        n.arguments.forEach((arg, i) => {
          const isFunction = ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)
          // a deferred callback (useCallback, useEffect) may read later consts once it runs
          if (isFunction && !(RENDER_TIME_CALLBACK.has(hook) && i === 0)) return
          for (const id of identifiersIn(arg)) {
            const at = declaredAt.get(id.text)
            if (at !== undefined && at > id.getStart()) {
              problems.push(
                `line ${lineOf(id.getStart())}: ${hook}() reads '${id.text}' declared at line ${lineOf(at)}`,
              )
            }
          }
        })
      }
      n.forEachChild(visit)
    }
    for (const st of body.statements) visit(st)
  }

  const findComponents = (n: ts.Node) => {
    if (
      (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
      n.body &&
      ts.isBlock(n.body) &&
      n.body.statements.length > 50
    ) {
      checkComponent(n.body)
    }
    n.forEachChild(findComponents)
  }
  findComponents(file)
  return problems
}

describe('pdf App render order', () => {
  it('no render-time hook work reads a component const declared later (TDZ)', () => {
    expect(renderTimeUseBeforeDeclaration(readFileSync(APP_PATH, 'utf8'))).toEqual([])
  })

  it('the scan catches the ocrBakeAll / pageGeomRef shape', () => {
    const filler = Array.from({ length: 60 }, (_, i) => `  const filler${i} = ${i}`).join('\n')
    const bad = `function App() {\n${filler}\n  const bake = useMemo(() => pageGeomRef.current(0), [])\n  const pageGeomRef = useRef(null)\n}`
    expect(renderTimeUseBeforeDeclaration(bad)).toHaveLength(1)
    const good = `function App() {\n${filler}\n  const pageGeomRef = useRef(null)\n  const bake = useMemo(() => pageGeomRef.current(0), [])\n  const cb = useCallback(() => later.current, [])\n  const later = useRef(0)\n}`
    expect(renderTimeUseBeforeDeclaration(good)).toEqual([])
  })

  it('ocrBakeAll is declared after pageGeomRef', () => {
    const src = readFileSync(APP_PATH, 'utf8')
    expect(src.indexOf('const ocrBakeAll = useMemo')).toBeGreaterThan(
      src.indexOf('const pageGeomRef = useRef'),
    )
  })
})
