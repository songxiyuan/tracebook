/**
 * Shared graph analysis for the diagram "semantic passport" (语义护照), reused by
 * both the flow (Vue Flow + ELK) and sequence renderers. The model is a plain
 * directed graph of `{id,label,kind}` nodes and `{source,target}` edges, so a
 * sequence (participants + messages) and a flow (nodes + edges) feed the same
 * panel.
 */
export interface GNode { id: string; label: string; kind?: string; sublabel?: string; tag?: string }
export interface GEdge { source: string; target: string; label?: string }

export interface PassportNeighbor { id: string; label: string; edgeLabel?: string }
export interface Passport {
  node: GNode
  /** Direct out-edges (this → neighbor). */
  outgoing: PassportNeighbor[]
  /** Direct in-edges (neighbor → this). */
  incoming: PassportNeighbor[]
  /** Self-loops touching the node. */
  loops: number
  /** Transitively reachable node counts (BFS, excluding the origin). */
  upstreamCount: number
  downstreamCount: number
}

/** Breadth-first set of nodes reachable from `origin`, following edges forward (down) or backward (up). */
export function reachable(origin: string, nodes: GNode[], edges: GEdge[], direction: 'up' | 'down'): Set<string> {
  const adjacency = new Map<string, string[]>()
  for (const node of nodes) adjacency.set(node.id, [])
  for (const edge of edges) {
    if (edge.source === edge.target) continue
    if (direction === 'down') adjacency.get(edge.source)?.push(edge.target)
    else adjacency.get(edge.target)?.push(edge.source)
  }
  const seen = new Set<string>([origin])
  const queue = [origin]
  while (queue.length) {
    const current = queue.shift()!
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  seen.delete(origin)
  return seen
}

/** Build the passport for one node: direct neighbors + transitive reach counts. */
export function buildPassport(id: string, nodes: GNode[], edges: GEdge[]): Passport | undefined {
  const node = nodes.find((candidate) => candidate.id === id)
  if (!node) return undefined
  const labelById = new Map(nodes.map((candidate) => [candidate.id, candidate.label]))
  const outgoing: PassportNeighbor[] = []
  const incoming: PassportNeighbor[] = []
  let loops = 0
  for (const edge of edges) {
    if (edge.source === id && edge.target === id) { loops += 1; continue }
    if (edge.source === id) outgoing.push({ id: edge.target, label: labelById.get(edge.target) ?? edge.target, edgeLabel: edge.label })
    else if (edge.target === id) incoming.push({ id: edge.source, label: labelById.get(edge.source) ?? edge.source, edgeLabel: edge.label })
  }
  return {
    node,
    outgoing,
    incoming,
    loops,
    upstreamCount: reachable(id, nodes, edges, 'up').size,
    downstreamCount: reachable(id, nodes, edges, 'down').size,
  }
}
