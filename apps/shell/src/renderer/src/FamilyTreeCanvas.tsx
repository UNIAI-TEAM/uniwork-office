import { useMemo } from 'react'
import type { ReactElement } from 'react'
import { layoutFamilyTree, type FtLaidOutNode } from './family-tree-layout'
import type { WbFamilyTreeNode } from './workbench-pins'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function sideLabel(side: WbFamilyTreeNode['side'], vi: boolean): string {
  switch (side) {
    case 'paternal':
      return vi ? 'Nội' : 'Paternal'
    case 'maternal':
      return vi ? 'Ngoại' : 'Maternal'
    case 'self':
      return vi ? 'Bản thân' : 'Self'
    case 'spouse':
      return vi ? 'Vợ/Chồng' : 'Spouse'
    default:
      return vi ? 'Khác' : 'Other'
  }
}

function genCaption(g: number, vi: boolean): string {
  if (g === 0) return vi ? 'Thế hệ bạn' : 'Your generation'
  if (g > 0) return vi ? `Ông bà (+${g})` : `Ancestors (+${g})`
  return vi ? `Con cháu (${g})` : `Descendants (${g})`
}

export function FamilyTreeCanvas({
  nodes,
  vi,
  selectedId,
  onSelect,
}: {
  nodes: WbFamilyTreeNode[]
  vi: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
}): ReactElement {
  const layout = useMemo(() => layoutFamilyTree(nodes), [nodes])

  if (nodes.length === 0) {
    return (
      <div className="wb-ft-empty" role="status">
        <div className="wb-ft-empty-art" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <strong>{vi ? 'Cây gia phả còn trống' : 'Family tree is empty'}</strong>
        <p>
          {vi
            ? 'Thêm thành viên hoặc tải mẫu để xem cây liên kết theo thế hệ — dữ liệu chỉ lưu trên máy bạn.'
            : 'Add members or load a sample to see a linked generation tree — data stays on your device.'}
        </p>
      </div>
    )
  }

  return (
    <div className="wb-ft-stage">
      <div className="wb-ft-scroll">
        <div className="wb-ft-canvas" style={{ width: layout.width, height: layout.height }}>
          <svg
            className="wb-ft-edges"
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            {layout.spouseBars.map((b) => (
              <g key={b.id}>
                <line
                  className="wb-ft-spouse-line"
                  x1={b.x1}
                  y1={b.y}
                  x2={b.x2}
                  y2={b.y}
                />
                <circle className="wb-ft-spouse-dot" cx={(b.x1 + b.x2) / 2} cy={b.y} r={3.5} />
              </g>
            ))}
            {layout.edges.map((e) => {
              const path = `M ${e.x1} ${e.y1} C ${e.x1} ${e.midY}, ${e.x2} ${e.midY}, ${e.x2} ${e.y2}`
              return <path key={e.id} className="wb-ft-edge" d={path} fill="none" />
            })}
          </svg>

          {layout.generations.map((g) => {
            const row = layout.nodes.find((n) => n.node.generation === g)
            if (!row) return null
            return (
              <div
                key={`band-${g}`}
                className="wb-ft-gen-label"
                style={{ top: row.y - 22 }}
              >
                {genCaption(g, vi)}
              </div>
            )
          })}

          {layout.nodes.map((n) => (
            <PersonCard
              key={n.node.id}
              item={n}
              vi={vi}
              selected={selectedId === n.node.id}
              onSelect={() => onSelect(selectedId === n.node.id ? null : n.node.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function PersonCard({
  item,
  vi,
  selected,
  onSelect,
}: {
  item: FtLaidOutNode
  vi: boolean
  selected: boolean
  onSelect: () => void
}): ReactElement {
  const { node, x, y, w, h } = item
  return (
    <button
      type="button"
      className={`wb-ft-card side-${node.side}${selected ? ' is-selected' : ''}${
        node.gender ? ` gender-${node.gender}` : ''
      }`}
      style={{ left: x, top: y, width: w, height: h }}
      onClick={onSelect}
      aria-pressed={selected}
      title={node.note ?? node.name}
    >
      <span className="wb-ft-avatar" aria-hidden="true">
        {initials(node.name)}
      </span>
      <span className="wb-ft-card-body">
        <strong>{node.name}</strong>
        <span>
          {sideLabel(node.side, vi)}
          {node.birthYear ? ` · ${node.birthYear}` : ''}
        </span>
      </span>
    </button>
  )
}
