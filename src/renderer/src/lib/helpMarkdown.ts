import React, { type ReactNode } from 'react'
import { isHelpArticle } from '@shared/help-api'
import { parseDeepLink } from '@shared/deeplink'
import { openHelp, LOCAL_DEEP_LINK_EVENT } from './helpNavigation'

const h = React.createElement
export const helpHeadingId = (text: string): string => text.toLowerCase().replace(/[`*]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const HEADING = /^(#{1,3})\s+(.+)$/

// Help pages reach the bundle with whatever line endings the build checkout
// had, which is CRLF on Windows. `.` and `$` stop at `\r`, so every parse of
// a body splits here and nowhere else.
const helpLines = (body: string): string[] => body.split(/\r?\n/)

// Anchor ids for one body, in order: a repeated heading gets `-2`, `-3`.
// The outline and the renderer each walk the body with their own allocator,
// so an id is decided where the heading is, never matched up by position.
function headingIdAllocator(): (text: string) => string {
  const seen = new Map<string, number>()
  return text => {
    const base = helpHeadingId(text), count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count ? `${base}-${count + 1}` : base
  }
}

export function helpHeadings(body: string): Array<{ id: string; text: string; level: number }> {
  let fenced = false
  const nextId = headingIdAllocator()
  return helpLines(body).flatMap(line => {
    if (/^```/.test(line)) { fenced = !fenced; return [] }
    const m = !fenced && HEADING.exec(line)
    if (!m) return []
    return [{ id: nextId(m[2]), text: m[2], level: m[1].length }]
  })
}

export function openHelpHref(href: string, remote = false): void {
  if (remote) {
    if (isHelpArticle(href)) void window.bldeskApi.openExternal(href)
    return
  }
  if (href.startsWith('help:')) {
    const [slug, heading] = href.slice(5).split('#')
    openHelp({ slug, heading })
  } else if (href.startsWith('bldesk:')) {
    if (parseDeepLink(href)) window.dispatchEvent(new CustomEvent(LOCAL_DEEP_LINK_EVENT, { detail: href }))
  } else {
    try {
      const u = new URL(href)
      if (u.protocol === 'https:' || u.protocol === 'http:') void window.bldeskApi.openExternal(href)
    } catch { /* Unsupported relative or unsafe URL. */ }
  }
}

function inline(text: string, remote: boolean, depth = 0): ReactNode[] {
  if (depth > 4) return [text]
  const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^\s)]+)\)/g
  const nodes: ReactNode[] = []
  let start = 0, match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    nodes.push(text.slice(start, match.index))
    const key = match.index
    if (match[1]) nodes.push(h('code', { key, className: 'rounded bg-black/5 dark:bg-white/10 px-1 py-0.5 text-[0.9em] break-words' }, match[1]))
    else if (match[2]) nodes.push(h('strong', { key }, inline(match[2], remote, depth + 1)))
    else {
      const href = match[4]
      const allowed = remote ? isHelpArticle(href) : /^(https?:\/\/|help:|bldesk:)/.test(href)
      nodes.push(allowed ? h('a', { key, href, className: 'text-[#017cb6] dark:text-sky-400 underline break-words', onClick: (event: React.MouseEvent) => { event.preventDefault(); openHelpHref(href, remote) } }, inline(match[3], remote, depth + 1)) : match[3])
    }
    start = pattern.lastIndex
  }
  nodes.push(text.slice(start))
  return nodes
}

// Deliberately small Markdown subset. React escapes all text, including raw
// HTML. Service answers cannot contain actionable local/deep links.
export function renderHelpMarkdown(body: string, remote = false): ReactNode[] {
  const lines = helpLines(body)
  const nextId = headingIdAllocator()
  const nodes: ReactNode[] = []
  let i = 0
  const list = (line: string) => /^\s*(?:([-*])\s+|(\d+)\.\s+)(.+)$/.exec(line)
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (/^```/.test(line)) {
      const code: string[] = []; i++
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++])
      i++
      nodes.push(h('pre', { key: i, className: 'overflow-x-auto rounded-lg border border-[#ced4da] dark:border-[#373b3e] bg-[#f8f9fa] dark:bg-[#212529] p-3 text-xs' }, h('code', null, code.join('\n'))))
      continue
    }
    const title = HEADING.exec(line)
    if (title) {
      nodes.push(h(`h${title[1].length}`, { key: i++, id: nextId(title[2]), className: 'font-semibold text-[#212529] dark:text-[#f8f9fa] scroll-mt-4 ' + (title[1].length === 1 ? 'text-2xl' : title[1].length === 2 ? 'text-lg pt-3' : 'text-base pt-2') }, inline(title[2], remote)))
      continue
    }
    const first = list(line)
    if (first) {
      const ordered = !!first[2], items: ReactNode[] = []
      while (i < lines.length) {
        const item = list(lines[i])
        if (!item || !!item[2] !== ordered) break
        items.push(h('li', { key: i++ }, inline(item[3], remote)))
      }
      nodes.push(h(ordered ? 'ol' : 'ul', { key: `list-${i}`, ...(ordered ? { start: Number(first[2]) } : {}), className: `pl-6 space-y-2 ${ordered ? 'list-decimal' : 'list-disc'}` }, items))
      continue
    }
    const paragraph: string[] = []
    while (i < lines.length && lines[i].trim() && !HEADING.test(lines[i]) && !/^```/.test(lines[i]) && !list(lines[i])) paragraph.push(lines[i++])
    nodes.push(h('p', { key: i, className: 'whitespace-pre-line break-words leading-relaxed' }, inline(paragraph.join('\n'), remote)))
  }
  return nodes
}
