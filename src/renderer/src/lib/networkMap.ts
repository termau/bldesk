import type { AuditLevel, FwRule } from './firewallMatrix'
import { worldTcpPortDecision } from './firewallMatrix'

/**
 * Network map (FEATURES.md #10): a deterministic, schematic layout of the
 * account — not a force-directed graph. Traffic reads left to right:
 *
 *   internet rail → load balancers → servers, grouped by region and VPC
 *
 * Layout is pure and stable, so the same fleet always draws the same picture
 * (screenshots stay comparable, and nothing jiggles on refresh). Every number
 * here is in "world" pixels; the view applies pan/zoom on top.
 */

export interface MapServer {
  id: number
  name: string
  status: string
  power: 'on' | 'off' | 'unknown'
  region: string
  regionSlug: string
  vpcId: number | null
  publicIp?: string
  privateIp?: string
  /** Ports the world can reach, as a short label: "22 80 443", "all", "none". */
  exposure: string
  exposureLevel: AuditLevel | null
  flags: string[]
}

export interface MapLb {
  id: number
  name: string
  ip: string
  status: string
  protocols: string[]
  serverIds: number[]
  region: string
  /** The VPC this load balancer is a member of, when the members list says so. */
  vpcId?: number | null
}

export interface MapVpc {
  id: number
  name: string
  cidr: string
}

export type NodeKind = 'server' | 'lb' | 'internet'

export interface LayoutNode {
  id: string
  kind: NodeKind
  x: number
  y: number
  w: number
  h: number
  server?: MapServer
  lb?: MapLb
}

export interface LayoutColumn {
  region: string
  x: number
  w: number
}

export interface LayoutGroup {
  id: string
  kind: 'vpc' | 'novpc'
  label: string
  sub?: string
  x: number
  y: number
  w: number
  h: number
  vpcId?: number | null
  /** One column per region the box's members live in, left to right. */
  columns: LayoutColumn[]
}

export interface LayoutEdge {
  id: string
  from: string
  to: string
  kind: 'lb' | 'public'
  label?: string
  level?: AuditLevel | null
  /** Drawn only when its node is selected or "show public edges" is on. */
  onDemand: boolean
  path: string
  /** Label anchor. */
  lx: number
  ly: number
}

export interface Layout {
  nodes: LayoutNode[]
  groups: LayoutGroup[]
  edges: LayoutEdge[]
  width: number
  height: number
  nodeById: Map<string, LayoutNode>
}

// Geometry — tuned for 12px/11px text at zoom 1.
export const NODE_W = 196
export const NODE_H = 46
const NODE_GAP = 10
const ROWS_PER_COLUMN = 6
const VPC_PAD = 16
const VPC_HEADER = 28
/** Region label row inside a box, above that region's column of servers. */
const COLUMN_HEADER = 22
const VPC_GAP = 24
const ROW_GAP = 32
/** Boxes wrap to a new row past this width, so a big account stays roughly landscape. */
const MAX_ROW_W = 1500
const RAIL_X = 32
const RAIL_W = 44
const LB_X = 132
export const LB_W = 176
export const LB_H = 54
const VPC_X_WITH_LB = 372
const MARGIN = 32

export const serverNodeId = (id: number) => `s${id}`
export const lbNodeId = (id: number) => `lb${id}`
export const INTERNET_ID = 'internet'

type PortRange = [start: number, end: number]

function mergePortRanges(ranges: PortRange[]): PortRange[] {
  const merged: PortRange[] = []
  for (const range of ranges) {
    const previous = merged[merged.length - 1]
    if (previous && range[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], range[1])
    else merged.push([...range])
  }
  return merged
}

function formatPortRanges(ranges: PortRange[]): string {
  const labels = ranges.map(([start, end]) => start === end ? String(start) : `${start}-${end}`)
  const shown = labels.slice(0, 4).join(' ')
  return labels.length > 4 ? `${shown} +${labels.length - 4}` : shown
}

function tcpPortSegments(rules: FwRule[]): Array<{ range: PortRange; accepted: boolean }> {
  const boundaries = new Set<number>([1, 65536])
  for (const rule of rules) {
    const protocol = (rule.protocol || 'all').toLowerCase()
    if (!['tcp', 'all'].includes(protocol)) continue
    for (const raw of rule.destination_ports ?? []) {
      const match = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(raw.trim())
      if (!match) continue
      const left = Math.max(1, Math.min(65535, Number(match[1])))
      const right = Math.max(left, Math.min(65535, Number(match[2] ?? match[1])))
      boundaries.add(left)
      boundaries.add(right + 1)
    }
  }

  const points = [...boundaries].sort((a, b) => a - b)
  const segments: Array<{ range: PortRange; accepted: boolean }> = []
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]
    const end = points[i + 1] - 1
    if (start > end) continue
    segments.push({ range: [start, end], accepted: worldTcpPortDecision(rules, start) === 'accept' })
  }
  return segments
}

/** Exact public TCP exposure under ordered, first-match rules; null = unreadable. */
export function exposureLabel(rules: FwRule[] | null): string {
  if (rules === null) return '?'
  const segments = tcpPortSegments(rules)
  const allowed = mergePortRanges(segments.filter((s) => s.accepted).map((s) => s.range))
  const denied = mergePortRanges(segments.filter((s) => !s.accepted).map((s) => s.range))
  if (allowed.length === 0) return 'none'
  if (denied.length === 0) return 'all'

  const allowLabel = formatPortRanges(allowed)
  const denyLabel = `all except ${formatPortRanges(denied)}`
  return denyLabel.length <= allowLabel.length ? denyLabel : allowLabel
}

/** Does the world reach `port` on this server? */
export function exposes(rules: FwRule[] | null, port: number): boolean {
  return worldTcpPortDecision(rules, port) === 'accept'
}

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, (x2 - x1) * 0.5)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

export function layoutTopology(servers: MapServer[], vpcs: MapVpc[], lbs: MapLb[]): Layout {
  // No load balancers → no column for them; the VPC boxes move left.
  const VPC_X = lbs.length > 0 ? VPC_X_WITH_LB : LB_X
  const nodes: LayoutNode[] = []
  const groups: LayoutGroup[] = []
  const edges: LayoutEdge[] = []
  const nodeById = new Map<string, LayoutNode>()
  const vpcById = new Map(vpcs.map((v) => [v.id, v]))

  // --- Group: VPC (a network, which may span regions) → region columns →
  //     servers, all in stable name order. Servers with no VPC share one box.
  // Tier 2: every VPC the account has gets a box, members or not. Servers
  // whose vpc_id names a VPC we were not given still get a box, labelled by id.
  const byVpc = new Map<number | null, MapServer[]>()
  for (const v of vpcs) byVpc.set(v.id, [])
  for (const s of [...servers].sort((a, b) => a.name.localeCompare(b.name))) {
    const list = byVpc.get(s.vpcId) ?? []
    list.push(s)
    byVpc.set(s.vpcId, list)
  }
  // Tier 1: a load balancer is where traffic starts, so the VPC it belongs to
  // (or, failing that, the VPC its backends are in) comes first, in load-
  // balancer name order. Then the rest by name, No VPC last.
  const frontedRank = new Map<number | null, number>()
  ;[...lbs].sort((a, b) => a.name.localeCompare(b.name)).forEach((lb, i) => {
    if (lb.vpcId != null && !frontedRank.has(lb.vpcId)) frontedRank.set(lb.vpcId, i)
    for (const sid of lb.serverIds) {
      const s = servers.find((x) => x.id === sid)
      if (s && !frontedRank.has(s.vpcId)) frontedRank.set(s.vpcId, i)
    }
  })
  const vpcKeys = [...byVpc.keys()].sort((a, b) => {
    if (a === null) return 1
    if (b === null) return -1
    const ra = frontedRank.get(a) ?? Number.POSITIVE_INFINITY
    const rb = frontedRank.get(b) ?? Number.POSITIVE_INFINITY
    if (ra !== rb) return ra - rb
    return (vpcById.get(a)?.name ?? '').localeCompare(vpcById.get(b)?.name ?? '')
  })

  let x = VPC_X
  let y = MARGIN
  let rowBottom = y
  let maxRight = VPC_X
  for (const key of vpcKeys) {
    const members = byVpc.get(key)!
    const byRegion = new Map<string, MapServer[]>()
    for (const s of members) {
      const list = byRegion.get(s.region) ?? []
      list.push(s)
      byRegion.set(s.region, list)
    }
    const regions = [...byRegion.keys()].sort()

    // Box width: the sum of each region's columns; height: the tallest region.
    const columns: LayoutColumn[] = []
    let cx = VPC_PAD
    let maxRows = 0
    for (const region of regions) {
      const n = byRegion.get(region)!.length
      const cols = Math.ceil(n / ROWS_PER_COLUMN)
      const w = cols * NODE_W + (cols - 1) * NODE_GAP
      columns.push({ region, x: cx, w })
      cx += w + VPC_GAP
      maxRows = Math.max(maxRows, Math.min(n, ROWS_PER_COLUMN))
    }
    const empty = members.length === 0
    const boxW = empty ? NODE_W + VPC_PAD * 2 : cx - VPC_GAP + VPC_PAD
    const boxH = empty ? VPC_HEADER + VPC_PAD + 18 + VPC_PAD : VPC_HEADER + COLUMN_HEADER + VPC_PAD + maxRows * NODE_H + (maxRows - 1) * NODE_GAP + VPC_PAD

    // Wrap to a new row of boxes when this one would run past the width budget.
    if (x > VPC_X && x + boxW > VPC_X + MAX_ROW_W) {
      x = VPC_X
      y = rowBottom + ROW_GAP
    }

    const vpc = key === null ? null : vpcById.get(key)
    groups.push({
      id: key === null ? 'novpc' : `vpc-${key}`,
      kind: key === null ? 'novpc' : 'vpc',
      label: key === null ? 'No VPC' : (vpc?.name ?? `VPC #${key}`),
      sub: key === null ? 'public network only' : [vpc?.cidr, empty ? 'no members' : undefined].filter(Boolean).join(' · ') || undefined,
      x,
      y,
      w: boxW,
      h: boxH,
      vpcId: key,
      columns: columns.map((c) => ({ ...c, x: x + c.x }))
    })
    regions.forEach((region, ri) => {
      const col = columns[ri]
      byRegion.get(region)!.forEach((s, i) => {
        const c = Math.floor(i / ROWS_PER_COLUMN)
        const r = i % ROWS_PER_COLUMN
        const node: LayoutNode = {
          id: serverNodeId(s.id),
          kind: 'server',
          x: x + col.x + c * (NODE_W + NODE_GAP),
          y: y + VPC_HEADER + COLUMN_HEADER + VPC_PAD + r * (NODE_H + NODE_GAP),
          w: NODE_W,
          h: NODE_H,
          server: s
        }
        nodes.push(node)
        nodeById.set(node.id, node)
      })
    })
    x += boxW + VPC_GAP
    rowBottom = Math.max(rowBottom, y + boxH)
    maxRight = Math.max(maxRight, x - VPC_GAP)
  }

  const height = Math.max(rowBottom + MARGIN, 320)

  // --- Load balancers: at the mean y of their members, pushed apart to avoid overlap.
  const placed: LayoutNode[] = []
  for (const lb of [...lbs].sort((a, b) => a.name.localeCompare(b.name))) {
    const ys = lb.serverIds.map((id) => nodeById.get(serverNodeId(id))).filter(Boolean).map((n) => n!.y + n!.h / 2)
    let cy = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : MARGIN + VPC_HEADER + LB_H / 2
    const node: LayoutNode = { id: lbNodeId(lb.id), kind: 'lb', x: LB_X, y: cy - LB_H / 2, w: LB_W, h: LB_H, lb }
    placed.push(node)
  }
  placed.sort((a, b) => a.y - b.y)
  for (let i = 1; i < placed.length; i++) {
    const prev = placed[i - 1]
    if (placed[i].y < prev.y + prev.h + NODE_GAP) placed[i].y = prev.y + prev.h + NODE_GAP
  }
  for (const n of placed) {
    nodes.push(n)
    nodeById.set(n.id, n)
  }

  // --- Internet rail
  const rail: LayoutNode = { id: INTERNET_ID, kind: 'internet', x: RAIL_X, y: MARGIN, w: RAIL_W, h: height - MARGIN * 2 }
  nodes.push(rail)
  nodeById.set(rail.id, rail)

  // --- Edges
  for (const n of placed) {
    const lb = n.lb!
    edges.push({
      id: `e-${INTERNET_ID}-${n.id}`,
      from: INTERNET_ID,
      to: n.id,
      kind: 'public',
      label: lb.protocols.join(' ') || undefined,
      level: null,
      onDemand: false,
      path: bezier(rail.x + rail.w, n.y + n.h / 2, n.x, n.y + n.h / 2),
      lx: (rail.x + rail.w + n.x) / 2,
      ly: n.y + n.h / 2 - 6
    })
    for (const sid of lb.serverIds) {
      const t = nodeById.get(serverNodeId(sid))
      if (!t) continue
      edges.push({
        id: `e-${n.id}-${t.id}`,
        from: n.id,
        to: t.id,
        kind: 'lb',
        onDemand: false,
        path: bezier(n.x + n.w, n.y + n.h / 2, t.x, t.y + t.h / 2),
        lx: (n.x + n.w + t.x) / 2,
        ly: (n.y + n.h / 2 + t.y + t.h / 2) / 2
      })
    }
  }
  for (const n of nodes) {
    if (n.kind !== 'server' || !n.server?.publicIp) continue
    edges.push({
      id: `e-${INTERNET_ID}-${n.id}`,
      from: INTERNET_ID,
      to: n.id,
      kind: 'public',
      label: n.server.exposure,
      level: n.server.exposureLevel,
      onDemand: true,
      path: bezier(rail.x + rail.w, n.y + n.h / 2, n.x, n.y + n.h / 2),
      lx: (rail.x + rail.w + n.x) / 2,
      ly: n.y + n.h / 2 - 6
    })
  }

  return { nodes, groups, edges, width: maxRight + MARGIN, height, nodeById }
}

/** Fit a world of `w`×`h` into a viewport, centred, with padding. */
export function fitTransform(w: number, h: number, vw: number, vh: number, pad = 24): { x: number; y: number; k: number } {
  const k = Math.min((vw - pad * 2) / Math.max(w, 1), (vh - pad * 2) / Math.max(h, 1), 1.6)
  return { k, x: (vw - w * k) / 2, y: (vh - h * k) / 2 }
}
