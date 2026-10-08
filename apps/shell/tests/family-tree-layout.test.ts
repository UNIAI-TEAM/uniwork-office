import { describe, expect, it } from 'vitest'
import { layoutFamilyTree, sampleFamilyTree } from '../src/renderer/src/family-tree-layout'

describe('family-tree-layout', () => {
  it('lays out sample tree with edges and spouse bars', () => {
    const nodes = sampleFamilyTree(true)
    const layout = layoutFamilyTree(nodes)
    expect(layout.nodes).toHaveLength(nodes.length)
    expect(layout.edges.length).toBeGreaterThan(0)
    expect(layout.spouseBars.length).toBeGreaterThan(0)
    expect(layout.width).toBeGreaterThan(200)
    expect(layout.height).toBeGreaterThan(200)
    // Oldest generation higher on canvas than descendants
    const elder = layout.nodes.find((n) => n.node.generation === 2)!
    const child = layout.nodes.find((n) => n.node.generation === -1)!
    expect(elder.y).toBeLessThan(child.y)
  })

  it('returns empty canvas metrics for no nodes', () => {
    const layout = layoutFamilyTree([])
    expect(layout.nodes).toEqual([])
    expect(layout.edges).toEqual([])
  })
})
