import { HelpLink } from '../ui/HelpLink'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, ExternalLink, Globe, Loader2, Maximize2, Minus, Plus, Search, Terminal, Waypoints, X } from 'lucide-react'
import { components } from '@shared/api/schema'
import { BinaryLaneClient } from '../../api/client'
import { useFleetFirewalls, useLoadBalancers, useVpcMembers, useVpcs } from '../../api/queries'
import { auditServer, publicAddressesOf, worstLevel, type AuditLevel, type FwRule } from '../../lib/firewallMatrix'
import { notifyFailure } from '../../lib/failures'
import { openServerSsh } from '../../lib/openServerSsh'
import {
  INTERNET_ID,
  exposes,
  exposureLabel,
  fitTransform,
  layoutTopology,
  serverNodeId,
  type LayoutNode,
  type MapLb,
  type MapServer,
  type MapVpc
} from '../../lib/networkMap'
import { cardFooter, estimateFooter, type MeasureFooter } from '../../lib/mapFooter'
import { saveBlobFile, saveTextFile, type SaveResult } from '../../lib/saveFile'

type ServerResponse = components['schemas']['Server']

interface Props {
  client: BinaryLaneClient | null
  servers: ServerResponse[]
  onSelectServer: (server: ServerResponse) => void
}

/**
 * The network map (FEATURES.md #10). A schematic, not a hairball: the
 * internet on a rail at the left, load balancers in a column, servers boxed
 * by VPC inside region bands. Each server carries its own exposure port —
 * what the world can reach — coloured by the firewall audit, so the risky
 * path is visible without drawing thirty-three lines to the rail. Select a
 * node to draw its lines and read its details; export as SVG or PNG for a
 * ticket or a doc.
 */

const C = {
  brand: '#017cb6',
  gold: '#f1ca00',
  ok: '#10b981',
  off: '#f43f5e',
  amber: '#f59e0b',
  sky: '#0ea5e9'
}

const levelColour = (level: AuditLevel | null | undefined) => (level === 'red' ? C.off : level === 'amber' ? C.amber : level === 'info' ? C.sky : C.ok)

export const NetworkMap: React.FC<Props> = ({ client, servers, onSelectServer }) => {
  const vpcsQuery = useVpcs(client)
  const lbsQuery = useLoadBalancers(client)
  const serverIds = useMemo(() => servers.map((s) => s.id), [servers])
  const fleet = useFleetFirewalls(client, serverIds)
  const vpcIds = useMemo(() => ((vpcsQuery.data ?? []) as any[]).map((v) => v.id as number), [vpcsQuery.data])
  const membersQuery = useVpcMembers(client, vpcIds)
  const rulesByServer = fleet.data ?? new Map<number, FwRule[] | null>()

  const accountAddresses = useMemo(() => {
    const set = new Set<string>()
    for (const s of servers) for (const n of s.networks?.v4 ?? []) if (n.ip_address) set.add(n.ip_address)
    return set
  }, [servers])

  // --- Model. Tiered: load balancers → VPCs (from the VPC list and their
  // member lists) → servers. A server's own vpc_id is only the fallback while
  // the member lists load.
  const model = useMemo(() => {
    const serverVpc = new Map<number, number>()
    const lbVpc = new Map<number, number>()
    const members = membersQuery.data
    if (members) {
      for (const [vpcId, list] of members) {
        for (const m of list ?? []) {
          const rid = Number(m.resource_id)
          if (m.resource_type === 'server') serverVpc.set(rid, vpcId)
          else if (m.resource_type === 'load-balancer') lbVpc.set(rid, vpcId)
        }
      }
    }
    const mapServers: MapServer[] = servers.map((s) => {
      const rules = rulesByServer.has(s.id) ? (rulesByServer.get(s.id) ?? null) : null
      const publicAddresses = publicAddressesOf(s)
      const flags = rulesByServer.has(s.id) ? auditServer(rules, accountAddresses, publicAddresses) : []
      const power = (s as any)._power?.state as MapServer['power'] | undefined
      return {
        id: s.id,
        name: s.name,
        status: s.status,
        power: power ?? (s.status === 'active' ? 'on' : s.status === 'off' ? 'off' : 'unknown'),
        region: s.region?.name || s.region?.slug || 'Unknown region',
        regionSlug: s.region?.slug || '',
        vpcId: members ? (serverVpc.get(s.id) ?? null) : (s.vpc_id ?? null),
        publicIp: s.networks?.v4?.find((n) => n.type === 'public')?.ip_address,
        privateIp: s.networks?.v4?.find((n) => n.type === 'private')?.ip_address,
        exposure: rulesByServer.has(s.id) ? exposureLabel(rules, publicAddresses) : '…',
        exposureLevel: rulesByServer.has(s.id) ? worstLevel(flags) : null,
        flags: flags.map((f) => f.text)
      }
    })
    const mapVpcs: MapVpc[] = (vpcsQuery.data ?? []).map((v: any) => ({ id: v.id, name: v.name, cidr: v.ip_range }))
    const mapLbs: MapLb[] = (lbsQuery.data ?? []).map((lb: any) => ({
      id: lb.id,
      name: lb.name,
      ip: lb.ip,
      status: lb.status,
      protocols: (lb.forwarding_rules ?? []).map((r: any) => r.entry_protocol).filter(Boolean),
      serverIds: lb.server_ids ?? [],
      region: lb.region?.name || '',
      vpcId: lbVpc.get(lb.id) ?? null
    }))
    // Counted here, with the cards, rather than on every pan and zoom frame.
    const exposedSsh = servers.filter((s) => rulesByServer.has(s.id) && exposes(rulesByServer.get(s.id) ?? null, 22, publicAddressesOf(s))).length
    return { mapServers, mapVpcs, mapLbs, exposedSsh }
  }, [servers, rulesByServer, accountAddresses, vpcsQuery.data, lbsQuery.data, membersQuery.data])

  const layout = useMemo(() => layoutTopology(model.mapServers, model.mapVpcs, model.mapLbs), [model])

  // --- View state
  // The footer's two halves are measured as the browser draws them, so the font in use (Menlo, Consolas, DejaVu) decides.
  const measureFooter = useMemo<MeasureFooter>(() => {
    try {
      const ctx = document.createElement('canvas').getContext('2d')
      if (!ctx) return estimateFooter
      const family = 'ui-monospace, SFMono-Regular, Menlo, monospace'
      return (text, role) => {
        ctx.font = role === 'port' ? `700 9px ${family}` : `9.5px ${family}`
        return ctx.measureText(text).width
      }
    } catch {
      return estimateFooter
    }
  }, [])
  // Measured once per layout, not on every pan and zoom render.
  const footers = useMemo(() => {
    const m = new Map<string, ReturnType<typeof cardFooter>>()
    for (const n of layout.nodes) if (n.kind === 'server') m.set(n.id, cardFooter(n.server!.exposure, n.server!.publicIp, n.server!.privateIp, n.w, measureFooter))
    return m
  }, [layout, measureFooter])
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [viewport, setViewport] = useState({ w: 800, h: 600 })
  const [selected, setSelected] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showPublic, setShowPublic] = useState(false)
  // An export in progress: Android's Save as dialog stays open until the person answers it, so a second tap must wait.
  const exportBusy = useRef(false)
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState('')
  const fitted = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setViewport({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  /*
   * Pan and zoom gestures write the transform straight onto the world group, at most once a frame, and commit it to
   * `view` when the gesture ends: setting state on every move re-rendered every card and line while dragging.
   * `liveView` is the transform on screen; handlers start from it, not from `view`, which can be a gesture behind.
   */
  const worldRef = useRef<SVGGElement>(null)
  const liveView = useRef(view)
  const frame = useRef(0)
  const wheelIdle = useRef<ReturnType<typeof setTimeout>>()
  const paint = (v: { x: number; y: number; k: number }) => worldRef.current?.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.k})`)
  const previewView = (next: { x: number; y: number; k: number }) => {
    liveView.current = next
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      paint(liveView.current)
    })
  }
  const commitView = useCallback((next: { x: number; y: number; k: number }) => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    clearTimeout(wheelIdle.current)
    liveView.current = next
    // React skips the attribute when the committed value matches its last render, which a gesture may have moved since.
    paint(next)
    setView(next)
  }, [])
  useEffect(() => () => {
    cancelAnimationFrame(frame.current)
    clearTimeout(wheelIdle.current)
  }, [])

  const fit = useCallback(() => {
    commitView(fitTransform(layout.width, layout.height, viewport.w, viewport.h))
  }, [layout.width, layout.height, viewport.w, viewport.h, commitView])

  // Fit once the first real layout exists, then leave the user's view alone.
  useEffect(() => {
    if (!fitted.current && layout.nodes.length > 1 && viewport.w > 0) {
      fitted.current = true
      fit()
    }
  }, [layout.nodes.length, viewport.w, fit])

  const zoomed = (v: { x: number; y: number; k: number }, factor: number, cx?: number, cy?: number) => {
    const k = Math.min(3, Math.max(0.2, v.k * factor))
    const px = cx ?? viewport.w / 2
    const py = cy ?? viewport.h / 2
    // Zoom about the pointer: keep the world point under the cursor fixed.
    return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k }
  }
  const zoomBy = (factor: number) => commitView(zoomed(liveView.current, factor))

  // A native listener, because React's wheel listener is passive: its preventDefault was ignored, so the page
  // scrolled and Ctrl + wheel zoomed the whole app as well as the map.
  const onWheel = (e: WheelEvent) => {
    // The detail panel scrolls itself. Ctrl + wheel (and a trackpad pinch, which arrives as one) over it zooms nothing:
    // left alone it would zoom the whole app, while the same gesture beside the panel zooms the map.
    if ((e.target as Element | null)?.closest?.('[data-map-panel]')) {
      if (e.ctrlKey || e.metaKey) e.preventDefault()
      return
    }
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    const cx = e.clientX - (rect?.left ?? 0)
    const cy = e.clientY - (rect?.top ?? 0)
    const v = liveView.current
    previewView(e.ctrlKey || e.metaKey ? zoomed(v, e.deltaY < 0 ? 1.12 : 1 / 1.12, cx, cy) : { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
    clearTimeout(wheelIdle.current)
    wheelIdle.current = setTimeout(() => commitView(liveView.current), 150)
  }
  const onWheelRef = useRef(onWheel)
  onWheelRef.current = onWheel
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const listener = (e: WheelEvent) => onWheelRef.current(e)
    el.addEventListener('wheel', listener, { passive: false })
    return () => el.removeEventListener('wheel', listener)
  }, [])

  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, vx: liveView.current.x, vy: liveView.current.y, moved: false }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    previewView({ ...liveView.current, x: d.vx + dx, y: d.vy + dy })
  }
  /*
   * Touch: one finger pans, two pinch to zoom.
   *
   * The map had mouse and wheel handlers only, so on a phone it was a picture -
   * you could not move it or zoom it at all. Pinch keeps the world point the
   * fingers started on under the fingers, the same rule `zoomBy` uses for the
   * cursor, so the map grows around what you are looking at rather than the
   * centre - and travels with the gesture when the fingers also move.
   *
   * `touch-action: none` on the container matters: without it the browser
   * claims the gesture for page scrolling and the handlers never see a move.
   */
  const touch = useRef<
    | { mode: 'pan'; x: number; y: number; vx: number; vy: number }
    | { mode: 'pinch'; dist: number; cx: number; cy: number; from: { x: number; y: number; k: number } }
    | null
  >(null)

  const localPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = containerRef.current?.getBoundingClientRect()
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
  }

  const startPan = (t: React.Touch): void => {
    touch.current = { mode: 'pan', x: t.clientX, y: t.clientY, vx: liveView.current.x, vy: liveView.current.y }
  }

  const onTouchStart = (e: React.TouchEvent): void => {
    if (e.touches.length === 1) {
      startPan(e.touches[0])
    } else if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]]
      const mid = localPoint((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2)
      touch.current = {
        mode: 'pinch',
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        cx: mid.x,
        cy: mid.y,
        from: { ...liveView.current }
      }
    }
  }

  const onTouchMove = (e: React.TouchEvent): void => {
    const t = touch.current
    if (!t) return
    if (t.mode === 'pan' && e.touches.length === 1) {
      const p = e.touches[0]
      previewView({ ...liveView.current, x: t.vx + (p.clientX - t.x), y: t.vy + (p.clientY - t.y) })
    } else if (t.mode === 'pinch' && e.touches.length === 2 && t.dist > 0) {
      const [a, b] = [e.touches[0], e.touches[1]]
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      const k = Math.min(3, Math.max(0.2, t.from.k * (dist / t.dist)))
      /*
       * The translation term follows the *current* midpoint; only the anchor
       * being held is the one the gesture started on. Using the starting
       * midpoint for both meant two fingers moving together with an unchanged
       * span produced no movement at all - a pinch could zoom but never drag.
       */
      const mid = localPoint((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2)
      previewView({
        k,
        x: mid.x - ((t.cx - t.from.x) * k) / t.from.k,
        y: mid.y - ((t.cy - t.from.y) * k) / t.from.k
      })
    }
  }

  const onTouchEnd = (e: React.TouchEvent): void => {
    // Lifting one finger of a pinch continues as a pan from where the view is
    // now, rather than snapping back to where the pinch began.
    if (e.touches.length === 1) startPan(e.touches[0])
    else if (e.touches.length === 0 && touch.current) {
      touch.current = null
      commitView(liveView.current)
    }
  }

  const onMouseUp = () => {
    const d = drag.current
    drag.current = null
    if (d && !d.moved) setSelected(null)
    else if (d) commitView(liveView.current)
  }

  // --- Derived: what to highlight
  const focus = hover ?? selected
  const related = useMemo(() => {
    const set = new Set<string>()
    if (!focus) return set
    set.add(focus)
    for (const e of layout.edges) {
      if (e.from === focus) set.add(e.to)
      if (e.to === focus) set.add(e.from)
    }
    return set
  }, [focus, layout.edges])

  const q = query.trim().toLowerCase()
  const matches = (n: LayoutNode) => {
    if (!q) return true
    if (n.kind === 'server') return [n.server!.name, n.server!.publicIp, n.server!.privateIp, n.server!.exposure].some((v) => (v ?? '').toLowerCase().includes(q))
    if (n.kind === 'lb') return [n.lb!.name, n.lb!.ip].some((v) => (v ?? '').toLowerCase().includes(q))
    return true
  }

  const visibleEdges = layout.edges.filter((e) => !e.onDemand || showPublic || (focus && (e.from === focus || e.to === focus)))

  const selectedNode = selected ? layout.nodeById.get(selected) : undefined

  // --- Export
  const exportSvg = (): string => {
    const svg = svgRef.current
    if (!svg) return ''
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(layout.width))
    clone.setAttribute('height', String(layout.height))
    clone.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`)
    // Fills, strokes and the font come from Tailwind classes, which a saved file does not carry: without this every card
    // and band exports black. Write what the page paints (current theme included) onto each shape. Before the [data-bg] fill below.
    const shapes = 'rect, circle, ellipse, line, path, text'
    const painted = clone.querySelectorAll(shapes)
    svg.querySelectorAll(shapes).forEach((el, i) => {
      const style = getComputedStyle(el)
      painted[i].setAttribute('fill', style.fill)
      painted[i].setAttribute('stroke', style.stroke)
      if (el.tagName === 'text') painted[i].setAttribute('font-family', style.fontFamily)
    })
    const g = clone.querySelector('[data-world]')
    g?.setAttribute('transform', '')
    const dark = document.documentElement.classList.contains('dark')
    const bg = clone.querySelector('[data-bg]')
    bg?.setAttribute('width', String(layout.width))
    bg?.setAttribute('height', String(layout.height))
    bg?.setAttribute('fill', dark ? '#212529' : '#f8f9fa')
    return new XMLSerializer().serializeToString(clone)
  }
  const mapSvg = (): string => {
    const src = exportSvg()
    if (!src) throw new Error('The map is not on screen, so there is nothing to export.')
    return src
  }
  /** The map drawn onto a canvas at twice its size. */
  const renderPng = () =>
    new Promise<Blob>((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(new Blob([mapSvg()], { type: 'image/svg+xml' }))
      img.onload = () => {
        try {
          const scale = 2
          const canvas = document.createElement('canvas')
          canvas.width = layout.width * scale
          canvas.height = layout.height * scale
          const ctx = canvas.getContext('2d')!
          ctx.scale(scale, scale)
          ctx.drawImage(img, 0, 0)
          canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The map could not be drawn as an image.'))), 'image/png')
        } catch (err) {
          reject(err)
        }
        URL.revokeObjectURL(url)
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('The map could not be drawn as an image.'))
      }
      img.src = url
    })
  const runExport = async (save: () => Promise<SaveResult>, preparing?: string) => {
    if (exportBusy.current) return
    exportBusy.current = true
    setExporting(true)
    setExportStatus('')
    // Drawing the PNG took 13 seconds on a phone, with nothing else to show for it: say so, but not for the blink it takes on a desktop.
    const slow = preparing ? setTimeout(() => setExportStatus(preparing), 600) : undefined
    let status = ''
    try {
      const result = await save()
      // Only where the system says (the Android app): a browser download cannot be known to have been kept.
      if (result.saved) status = result.name ? `Saved as ${result.name}.` : 'Saved the network map.'
    } catch (err) {
      notifyFailure('Could not export the network map', err)
    } finally {
      clearTimeout(slow)
      exportBusy.current = false
      setExporting(false)
      setExportStatus(status)
    }
  }
  const exportAsSvg = () => runExport(() => saveTextFile('bldesk-network-map.svg', mapSvg(), 'image/svg+xml'))
  const exportAsPng = () => runExport(async () => saveBlobFile('bldesk-network-map.png', await renderPng()), 'Preparing the PNG…')

  const loading = vpcsQuery.isLoading || lbsQuery.isLoading || membersQuery.isLoading
  const counts = {
    servers: model.mapServers.length,
    vpcs: model.mapVpcs.length,
    lbs: model.mapLbs.length,
    exposedSsh: model.exposedSsh
  }
  // A read that failed must not look like "none": say what the counts could not see.
  const vpcsUnread = vpcsQuery.isError && vpcsQuery.data === undefined
  const lbsUnread = lbsQuery.isError && lbsQuery.data === undefined
  const firewallUnread = fleet.isError ? servers.length : servers.filter((s) => rulesByServer.has(s.id) && rulesByServer.get(s.id) === null).length

  return (
    <div className="h-full flex flex-col bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa] overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2.5">
            <Waypoints className="w-5 h-5 text-fg-link" />
            Network Map
          </h1>
          <p className="text-xs text-fg-muted dark:text-slate-400 mt-0.5">
            {counts.servers} servers · {vpcsUnread ? 'VPCs not read' : `${counts.vpcs} VPC${counts.vpcs === 1 ? '' : 's'}`} · {lbsUnread ? 'load balancers not read' : `${counts.lbs} load balancer${counts.lbs === 1 ? '' : 's'}`}
            {counts.exposedSsh > 0 && <span className="text-rose-600 dark:text-rose-400"> · SSH reachable from the internet on {counts.exposedSsh}</span>}
            {firewallUnread > 0 && !fleet.isLoading && (
              <span role="alert" className="text-amber-600 dark:text-amber-400"> · firewall rules not read on {firewallUnread}, so exposure is unknown there</span>
            )}
            {(loading || fleet.isLoading) && (
              <span className="inline-flex items-center gap-1 ml-2">
                <Loader2 className="w-3 h-3 animate-spin" /> reading…
              </span>
            )}
          </p>
          {exportStatus && (
            <p role="status" className="text-xs text-fg-muted dark:text-slate-400 mt-0.5">
              {exportStatus}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-fg-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a server or address"
              className="pl-8 pr-3 py-1.5 w-52 bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded focus:outline-none focus:border-[#017cb6]"
            />
          </div>
          <label className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded cursor-pointer select-none">
            <input type="checkbox" checked={showPublic} onChange={(e) => setShowPublic(e.target.checked)} />
            <Globe className="w-3.5 h-3.5 text-fg-muted" /> Public paths
          </label>
          <div className="flex items-center bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded overflow-hidden">
            <button onClick={() => zoomBy(1 / 1.25)} className="px-2 py-1.5 hover:bg-[#f1f1f1] dark:hover:bg-[#343a40]" title="Zoom out">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button onClick={fit} className="px-2 py-1.5 hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border-x border-[#ced4da] dark:border-[#373b3e]" title="Fit to window">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => zoomBy(1.25)} className="px-2 py-1.5 hover:bg-[#f1f1f1] dark:hover:bg-[#343a40]" title="Zoom in">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded overflow-hidden">
            <button onClick={exportAsPng} disabled={exporting} className="px-2.5 py-1.5 hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] flex items-center gap-1 disabled:opacity-50" title="Export PNG (2×)">
              <Download className="w-3.5 h-3.5" /> PNG
            </button>
            <button onClick={exportAsSvg} disabled={exporting} className="px-2.5 py-1.5 hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border-l border-[#ced4da] dark:border-[#373b3e] disabled:opacity-50" title="Export SVG">
              SVG
            </button>
          </div>
          <HelpLink slug="map" />
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative min-h-0 mx-6 mb-6 rounded-lg border border-[#ced4da] dark:border-[#373b3e] overflow-hidden bg-white dark:bg-[#1c2024]">
        <div
          ref={containerRef}
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
          style={{ touchAction: 'none' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          <svg ref={svgRef} className="w-full h-full select-none" style={{ fontFamily: 'inherit' }}>
            <defs>
              <pattern id="map-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path d="M 24 0 L 0 0 0 24" fill="none" className="stroke-[#212529]/[0.06] dark:stroke-white/[0.05]" strokeWidth="1" />
              </pattern>
              <marker id="map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={C.brand} />
              </marker>
              <marker id="map-arrow-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={C.off} />
              </marker>
              <marker id="map-arrow-grey" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#6c757d" />
              </marker>
              <filter id="map-shadow" x="-10%" y="-10%" width="120%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.18" />
              </filter>
              <style>{`
                .map-edge { fill: none; stroke-width: 1.5; transition: opacity .15s ease; }
                .map-edge-dash { stroke-dasharray: 6 5; animation: map-flow 1.2s linear infinite; }
                @keyframes map-flow { to { stroke-dashoffset: -22; } }
                @media (prefers-reduced-motion: reduce) { .map-edge-dash { animation: none; } }
                .map-node { transition: opacity .15s ease, transform .15s ease; }
              `}</style>
            </defs>
            <rect data-bg width="100%" height="100%" fill="transparent" />
            <rect width="100%" height="100%" fill="url(#map-grid)" pointerEvents="none" />

            <g data-world ref={worldRef} transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {/* VPC boxes with a region column header inside each */}
              {layout.groups.map((g) => (
                <g key={g.id}>
                  <rect
                    x={g.x}
                    y={g.y}
                    width={g.w}
                    height={g.h}
                    rx={10}
                    className={g.kind === 'vpc' ? 'fill-[#017cb6]/[0.04] dark:fill-[#017cb6]/[0.08] stroke-[#017cb6]/40' : 'fill-transparent stroke-[#adb5bd] dark:stroke-[#495057]'}
                    strokeWidth={1.25}
                    strokeDasharray={g.kind === 'vpc' ? undefined : '5 4'}
                  />
                  <text x={g.x + 14} y={g.y + 18} className={g.kind === 'vpc' ? 'fill-[#015f8c] dark:fill-[#5fc3f0]' : 'fill-[#6c757d] dark:fill-slate-400'} fontSize={11} fontWeight={700}>
                    {g.label}
                  </text>
                  {g.sub && (
                    <text x={g.x + 14 + g.label.length * 6.6 + 8} y={g.y + 18} className="fill-[#6c757d] dark:fill-slate-500" fontSize={10} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
                      {g.sub}
                    </text>
                  )}
                  {g.columns.map((c) => (
                    <g key={c.region}>
                      <text x={c.x} y={g.y + 28 + 12} className="fill-[#6c757d] dark:fill-slate-400" fontSize={9.5} fontWeight={700} letterSpacing={1.4}>
                        {c.region.toUpperCase()}
                      </text>
                      <line x1={c.x} y1={g.y + 28 + 17} x2={c.x + 24} y2={g.y + 28 + 17} stroke={C.gold} strokeWidth={2} />
                    </g>
                  ))}
                </g>
              ))}

              {/* Edges (under nodes) */}
              {visibleEdges.map((e) => {
                const dim = focus ? !(e.from === focus || e.to === focus) : false
                const colour = e.kind === 'lb' ? C.brand : e.level === 'red' ? C.off : e.level === 'amber' ? C.amber : '#6c757d'
                const marker = e.kind === 'lb' ? 'url(#map-arrow)' : e.level === 'red' ? 'url(#map-arrow-red)' : 'url(#map-arrow-grey)'
                const active = focus && (e.from === focus || e.to === focus)
                return (
                  <g key={e.id} opacity={dim ? 0.12 : 1}>
                    <path d={e.path} className={`map-edge ${active ? 'map-edge-dash' : ''}`} stroke={colour} markerEnd={marker} strokeWidth={active ? 2 : 1.5} />
                    {e.label && (active || e.kind === 'public') && (
                      <text x={e.lx} y={e.ly} textAnchor="middle" fontSize={9.5} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fill={colour} fontWeight={600}>
                        {e.label}
                      </text>
                    )}
                  </g>
                )
              })}

              {/* Internet rail */}
              {(() => {
                const r = layout.nodeById.get(INTERNET_ID)!
                return (
                  <g>
                    <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={22} className="fill-[#343a40] dark:fill-[#0f1214] stroke-[#495057]" strokeWidth={1} />
                    <g transform={`translate(${r.x + r.w / 2} ${r.y + 28})`}>
                      <circle r={11} fill="none" stroke={C.gold} strokeWidth={1.5} />
                      <ellipse rx={5} ry={11} fill="none" stroke={C.gold} strokeWidth={1.2} />
                      <line x1={-11} y1={0} x2={11} y2={0} stroke={C.gold} strokeWidth={1.2} />
                    </g>
                    <text transform={`translate(${r.x + r.w / 2 + 4} ${r.y + 70}) rotate(90)`} fontSize={10} fontWeight={700} letterSpacing={2.4} fill="#adb5bd">
                      INTERNET
                    </text>
                  </g>
                )
              })()}

              {/* Load balancers */}
              {layout.nodes
                .filter((n) => n.kind === 'lb')
                .map((n) => {
                  const lb = n.lb!
                  const dim = (focus && !related.has(n.id)) || !matches(n)
                  const isSel = selected === n.id
                  return (
                    <g
                      key={n.id}
                      className="map-node cursor-pointer"
                      opacity={dim ? 0.25 : 1}
                      onMouseEnter={() => setHover(n.id)}
                      onMouseLeave={() => setHover(null)}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelected(isSel ? null : n.id)
                      }}
                    >
                      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={27} className="fill-white dark:fill-[#2b3035]" stroke={isSel ? C.gold : C.brand} strokeWidth={isSel ? 2.5 : 1.5} filter="url(#map-shadow)" />
                      <circle cx={n.x + 22} cy={n.y + n.h / 2} r={9} fill={C.brand} opacity={0.15} />
                      <circle cx={n.x + 22} cy={n.y + n.h / 2} r={4} fill={lb.status === 'active' ? C.ok : lb.status === 'errored' ? C.off : C.amber} />
                      <text x={n.x + 40} y={n.y + 22} fontSize={12} fontWeight={700} className="fill-[#212529] dark:fill-white">
                        {lb.name}
                      </text>
                      <text x={n.x + 40} y={n.y + 38} fontSize={10} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" className="fill-[#6c757d] dark:fill-slate-400">
                        {lb.ip} · {lb.protocols.join('/') || 'no rules'} · {lb.serverIds.length} backend{lb.serverIds.length === 1 ? '' : 's'}
                      </text>
                    </g>
                  )
                })}

              {/* Servers */}
              {layout.nodes
                .filter((n) => n.kind === 'server')
                .map((n) => {
                  const s = n.server!
                  const dim = (focus && !related.has(n.id)) || !matches(n)
                  const isSel = selected === n.id
                  // Grey until the rules have been read; "?" means they could not be.
                  const portColour = s.exposure === '…' || s.exposure === '?' ? '#adb5bd' : levelColour(s.exposureLevel)
                  const footer = footers.get(n.id)!
                  return (
                    <g
                      key={n.id}
                      className="map-node cursor-pointer"
                      opacity={dim ? 0.22 : 1}
                      onMouseEnter={() => setHover(n.id)}
                      onMouseLeave={() => setHover(null)}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelected(isSel ? null : n.id)
                      }}
                    >
                      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={7} className="fill-white dark:fill-[#2b3035]" filter="url(#map-shadow)" />
                      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={7} fill="none" className={isSel ? '' : 'stroke-[#ced4da] dark:stroke-[#3d4349]'} stroke={isSel ? C.gold : undefined} strokeWidth={isSel ? 2.5 : 1} />
                      {/* Exposure port: what the world reaches */}
                      <g>
                        <rect x={n.x - 1} y={n.y + 8} width={5} height={n.h - 16} rx={2} fill={portColour} />
                        <text x={n.x + 12} y={n.y + n.h - 9} fontSize={9} fontWeight={700} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fill={portColour}>
                          <title>{s.exposure}</title>
                          {footer.exposure}
                        </text>
                      </g>
                      {/* Power */}
                      <circle cx={n.x + 16} cy={n.y + 15} r={3.5} fill={s.power === 'on' ? C.ok : s.power === 'off' ? C.off : '#adb5bd'} />
                      <text x={n.x + 26} y={n.y + 19} fontSize={12} fontWeight={700} className="fill-[#212529] dark:fill-white">
                        {s.name.length > 22 ? s.name.slice(0, 21) + '…' : s.name}
                      </text>
                      <text x={n.x + n.w - 10} y={n.y + n.h - 9} textAnchor="end" fontSize={9.5} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" className="fill-[#6c757d] dark:fill-slate-400">
                        {footer.addresses}
                      </text>
                    </g>
                  )
                })}
            </g>
          </svg>

          {/* Legend */}
          <div className="absolute left-3 bottom-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 rounded bg-white/85 dark:bg-[#2b3035]/85 backdrop-blur border border-[#ced4da] dark:border-[#373b3e] text-[0.625rem] text-[#495057] dark:text-slate-300 pointer-events-none">
            <span className="flex items-center gap-1"><span className="inline-block w-1.5 h-3 rounded-sm" style={{ background: C.ok }} /> reachable ports</span>
            <span className="flex items-center gap-1"><span className="inline-block w-1.5 h-3 rounded-sm" style={{ background: C.off }} /> admin port open to the world</span>
            <span className="flex items-center gap-1"><span className="inline-block w-1.5 h-3 rounded-sm" style={{ background: C.amber }} /> no rules / shadowed</span>
            <span className="flex items-center gap-1"><span className="inline-block w-5 h-0.5" style={{ background: C.brand }} /> load balancer → backend</span>
            <span className="text-fg-muted">drag to pan · ⌘/Ctrl + wheel to zoom · click a node</span>
          </div>

          {/* Detail panel */}
          {selectedNode && (
            <div
              className="absolute right-3 top-3 w-72 max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-lg bg-white/95 dark:bg-[#2b3035]/95 backdrop-blur border border-[#ced4da] dark:border-[#373b3e] shadow-xl text-xs cursor-default"
              // The pan container clears the selection on a plain click, which
              // would unmount this panel before its buttons' click fires.
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
              data-map-panel
            >
              <div className="flex items-start justify-between gap-2 p-3 border-b border-[#ced4da] dark:border-[#373b3e]">
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate">{selectedNode.kind === 'lb' ? selectedNode.lb!.name : selectedNode.kind === 'server' ? selectedNode.server!.name : 'Internet'}</div>
                  <div className="text-[0.625rem] uppercase tracking-wider text-fg-muted">{selectedNode.kind === 'lb' ? 'Load balancer' : selectedNode.kind === 'server' ? 'Server' : 'Edge'}</div>
                </div>
                <button onClick={() => setSelected(null)} className="text-fg-muted hover:text-[#212529] dark:hover:text-white" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {selectedNode.kind === 'server' && (() => {
                const s = selectedNode.server!
                const lbs = model.mapLbs.filter((lb) => lb.serverIds.includes(s.id))
                const vpc = model.mapVpcs.find((v) => v.id === s.vpcId)
                const orig = servers.find((x) => x.id === s.id)
                return (
                  <div className="p-3 space-y-2.5">
                    <Row k="Power" v={s.power === 'on' ? 'running' : s.power === 'off' ? 'off' : 'unknown'} tone={s.power === 'on' ? 'ok' : s.power === 'off' ? 'bad' : undefined} />
                    <Row k="Public IPv4" v={s.publicIp ?? '—'} mono />
                    <Row k="Private IPv4" v={s.privateIp ?? '—'} mono />
                    <Row k="VPC" v={vpc ? `${vpc.name} (${vpc.cidr})` : s.vpcId ? `#${s.vpcId}` : 'none'} />
                    <Row k="Region" v={s.region} />
                    <Row
                      k="Reachable from internet"
                      v={s.exposure === '…' ? 'reading…' : s.exposure === '?' ? 'unknown' : s.exposure === 'all' ? 'all ports' : s.exposure === 'none' ? 'nothing' : s.exposure.startsWith('all but ') ? `all ports except ${s.exposure.slice('all but '.length)}` : `ports ${s.exposure}`}
                      mono
                      tone={s.exposure === '?' || s.exposure === '…' ? undefined : s.exposure === 'none' ? 'ok' : s.exposureLevel === 'red' ? 'bad' : s.exposureLevel === 'amber' ? 'warn' : 'ok'}
                    />
                    {s.flags.length > 0 && (
                      <ul className="space-y-1">
                        {s.flags.map((f, i) => (
                          <li key={i} className="px-2 py-1 rounded bg-amber-500/10 text-amber-800 dark:text-amber-200 border border-amber-500/30">{f}</li>
                        ))}
                      </ul>
                    )}
                    {lbs.length > 0 && <Row k="Behind" v={lbs.map((l) => l.name).join(', ')} />}
                    <div className="flex items-center gap-2 pt-1">
                      {orig && (
                        <button onClick={() => onSelectServer(orig)} className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded bg-[#017cb6] hover:bg-[#016594] text-white font-semibold">
                          <ExternalLink className="w-3.5 h-3.5" /> Open
                        </button>
                      )}
                      {(
                        <button onClick={() => { const server = servers.find((server) => server.id === s.id); if (server) void openServerSsh(server) }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#ced4da] dark:border-[#373b3e] hover:bg-[#f8f9fa] dark:hover:bg-[#32383e]">
                          <Terminal className="w-3.5 h-3.5" /> SSH
                        </button>
                      )}
                    </div>
                  </div>
                )
              })()}
              {selectedNode.kind === 'lb' && (() => {
                const lb = selectedNode.lb!
                return (
                  <div className="p-3 space-y-2.5">
                    <Row k="Status" v={lb.status} tone={lb.status === 'active' ? 'ok' : lb.status === 'errored' ? 'bad' : 'warn'} />
                    <Row k="Address" v={lb.ip} mono />
                    <Row k="Entry" v={lb.protocols.join(', ') || 'no forwarding rules'} mono />
                    <Row k="Region" v={lb.region || 'anycast'} />
                    <div>
                      <div className="text-fg-muted mb-1">Backends ({lb.serverIds.length})</div>
                      <ul className="space-y-0.5">
                        {lb.serverIds.map((id) => {
                          const s = model.mapServers.find((x) => x.id === id)
                          return (
                            <li key={id} className="flex items-center gap-1.5">
                              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: s?.power === 'on' ? C.ok : C.off }} />
                              <button onClick={() => setSelected(serverNodeId(id))} className="hover:underline">{s?.name ?? `#${id}`}</button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {layout.nodes.length <= 1 && !loading && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-fg-muted">No servers on this account yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}

const Row: React.FC<{ k: string; v: string; mono?: boolean; tone?: 'ok' | 'bad' | 'warn' }> = ({ k, v, mono, tone }) => (
  <div className="flex items-start justify-between gap-3">
    <span className="text-fg-muted dark:text-slate-400 flex-shrink-0">{k}</span>
    <span
      className={`text-right break-all ${mono ? 'font-mono' : ''} ${tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'bad' ? 'text-rose-600 dark:text-rose-400' : tone === 'warn' ? 'text-amber-700 dark:text-amber-300' : ''}`}
    >
      {v}
    </span>
  </div>
)
