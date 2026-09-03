import React, { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRightLeft } from 'lucide-react'
import { components } from '@shared/api/schema'
import { BinaryLaneClient } from '../../api/client'
import { useSizes, useImages } from '../../api/queries'
import {
  planUnavailableReason,
  isCapacityBlock,
  planMonthlyPrice,
  memoryChoices,
  diskChoices,
  billingTotal
} from '../../lib/serverPricing'

type Server = components['schemas']['Server']

/**
 * Change the server's plan - the `resize` action.
 *
 * Deliberately shares serverPricing with the create form: the licensed-image
 * surcharge, the availability reasons and the storage ladder have to agree
 * between the two, or the same plan shows a different price depending on which
 * screen you are looking at.
 */
export const ChangePlanPanel: React.FC<{
  client: BinaryLaneClient | null
  server: Server
  busy?: boolean
  onApply: (payload: Record<string, unknown>, summary: string, changes: Array<{ label: string; from?: string; to?: string }>) => void
}> = ({ client, server, busy, onApply }) => {
  const sizesQuery = useSizes(client)
  const imagesQuery = useImages(client)

  const region = server.region?.slug || ''
  const image = useMemo(
    () => (imagesQuery.data ?? []).find((i) => i.slug === server.image?.slug),
    [imagesQuery.data, server.image?.slug]
  )

  const allSizes = sizesQuery.data ?? []
  const typeSlugs = useMemo(
    () => Array.from(new Set(allSizes.map((s) => s.size_type?.slug).filter(Boolean))) as string[],
    [allSizes]
  )
  const [planType, setPlanType] = useState<string>(server.size?.size_type?.slug || 'vps')

  const plans = useMemo(
    () => allSizes.filter((s) => (s.size_type?.slug || 'vps') === planType),
    [allSizes, planType]
  )

  const [sizeSlug, setSizeSlug] = useState<string | null>(server.size_slug ?? null)
  const selected = plans.find((p) => p.slug === sizeSlug)

  const [memory, setMemory] = useState<number>(server.memory ?? 0)
  const [disk, setDisk] = useState<number>(server.disk ?? 0)

  // A different plan brings its own limits, so the adjustable options reset to
  // that plan's included amounts rather than carrying invalid values across.
  const pick = (slug: string): void => {
    const p = plans.find((x) => x.slug === slug)
    if (!p) return
    setSizeSlug(slug)
    setMemory(p.memory)
    setDisk(p.disk)
  }

  const blocks = useMemo(() => {
    const seen = new Map<string, { kind: string; message: string }>()
    for (const p of plans) {
      const b = planUnavailableReason(p, region, image)
      if (b) seen.set(b.message, b)
    }
    return [...seen.values()]
  }, [plans, region, image?.slug])
  const capacityOnly = blocks.length > 0 && blocks.every((b) => isCapacityBlock(b as never))

  if (sizesQuery.isLoading || imagesQuery.isLoading) {
    return <p className="text-xs text-[#6c757d] dark:text-slate-400">Loading plans...</p>
  }

  const monthly = selected ? planMonthlyPrice(selected, image, memory, disk) : 0
  const { total, gst } = billingTotal(monthly)
  const isShrink = !!selected && (memory < (server.memory ?? 0) || disk < (server.disk ?? 0))
  const unchanged =
    selected?.slug === server.size_slug && memory === (server.memory ?? 0) && disk === (server.disk ?? 0)

  const cellClass = 'py-1.5 px-1 sm:py-2 sm:px-3'

  /*
   * The server's own size is read from the server object, not looked up in the
   * plans list. A retired plan - GS1 runs `a-3040`, which /v2/sizes no longer
   * returns - would otherwise leave the panel with nothing marked current and no
   * indication of what the server is on today, which is the one thing you need
   * before choosing what to move to.
   */
  const currentInList = plans.some((p) => p.slug === server.size_slug)

  return (
    <div className="space-y-4">
      <div className="text-xs text-[#495057] dark:text-slate-300 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded p-2.5">
        <span className="font-semibold">Current plan:</span>{' '}
        <span className="font-mono">{server.size_slug}</span>
        {' - '}
        {(server.memory ?? 0) / 1024} GB memory, {server.disk} GB storage, {server.vcpus}{' '}
        {server.size?.vcpu_units || 'VCPU'}
        {server.vcpus === 1 ? '' : 's'}
        {typeof server.size?.price_monthly === 'number' && ` - $${server.size.price_monthly.toFixed(2)}/mo base`}
        {!currentInList && (
          <span className="block mt-1 text-[11px] text-amber-700 dark:text-amber-400">
            This plan is no longer offered, so it is not listed below. Moving off it cannot be undone.
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {typeSlugs.map((t) => {
          const name = allSizes.find((s) => s.size_type?.slug === t)?.size_type?.name || t
          return (
            <button
              key={t}
              type="button"
              onClick={() => setPlanType(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded border transition ${
                planType === t
                  ? 'bg-[#6c757d] text-white border-[#6c757d]'
                  : 'bg-[#f8f9fa] dark:bg-[#212529] text-[#495057] dark:text-[#adb5bd] border-[#ced4da] dark:border-[#373b3e]'
              }`}
            >
              {name}
            </button>
          )
        })}
      </div>

      <div className="border border-[#ced4da] dark:border-[#373b3e] rounded overflow-x-auto">
        <table className="w-full text-[10px] sm:text-xs whitespace-nowrap">
          <thead className="bg-[#f8f9fa] dark:bg-[#212529] text-[#495057] dark:text-[#adb5bd]">
            <tr>
              <th className={`${cellClass} font-semibold text-center`}>Processor</th>
              <th className={`${cellClass} font-semibold text-center`}>Memory</th>
              <th className={`${cellClass} font-semibold text-center`}>Storage</th>
              <th className={`${cellClass} font-semibold text-center`}>Transfer</th>
              <th className={`${cellClass} font-semibold text-center`}>Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
            {plans.map((p) => {
              const blocked = planUnavailableReason(p, region, image)
              const isSel = selected?.slug === p.slug
              const isCurrent = p.slug === server.size_slug
              return (
                <tr
                  key={p.slug}
                  onClick={() => !blocked && pick(p.slug)}
                  title={blocked?.message || undefined}
                  className={`${blocked ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'} ${
                    isSel ? 'bg-[#017cb6]/10' : ''
                  }`}
                >
                  <td className={cellClass}>
                    <span className="flex items-center gap-1 sm:gap-2">
                      <span
                        className={`w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                          isSel ? 'border-[#017cb6]' : 'border-[#ced4da] dark:border-[#6c757d]'
                        }`}
                      >
                        {isSel && <span className="w-2 h-2 rounded-full bg-[#017cb6]" />}
                      </span>
                      <span className="text-[#212529] dark:text-white">
                        {p.vcpus} {p.vcpu_units || 'VCPU'}
                        {p.vcpus === 1 ? '' : 's'}
                      </span>
                      {isCurrent && <span className="text-[#6c757d] dark:text-slate-400">(current)</span>}
                    </span>
                  </td>
                  <td className={`${cellClass} text-center`}>
                    {isSel && memoryChoices(p).length > 1 ? (
                      <select
                        value={memory}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setMemory(Number(e.target.value))}
                        className="px-1 py-0.5 text-[10px] sm:text-xs rounded border border-[#ced4da] dark:border-[#373b3e] bg-white dark:bg-[#2b3035]"
                      >
                        {memoryChoices(p).map((m) => (
                          <option key={m} value={m}>
                            {m / 1024} GB
                          </option>
                        ))}
                      </select>
                    ) : (
                      `${p.memory / 1024} GB`
                    )}
                  </td>
                  <td className={`${cellClass} text-center`}>
                    {isSel && diskChoices(p).length > 1 ? (
                      <select
                        value={disk}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setDisk(Number(e.target.value))}
                        className="px-1 py-0.5 text-[10px] sm:text-xs rounded border border-[#ced4da] dark:border-[#373b3e] bg-white dark:bg-[#2b3035]"
                      >
                        {diskChoices(p).map((d) => (
                          <option key={d} value={d}>
                            {d} GB
                          </option>
                        ))}
                      </select>
                    ) : (
                      `${p.disk} GB`
                    )}
                  </td>
                  <td className={`${cellClass} text-center`}>{p.transfer * 1000} GB</td>
                  <td className={`${cellClass} text-center font-medium`}>
                    ${planMonthlyPrice(p, image, p.memory, p.disk).toFixed(2)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {blocks.length > 0 && (
          <div className="px-3 py-2 border-t border-[#ced4da] dark:border-[#373b3e] bg-[#f8f9fa] dark:bg-[#212529] text-[11px] text-[#6c757d] dark:text-[#adb5bd] space-y-1">
            {capacityOnly ? (
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500 mt-px" />
                <span>We currently do not have resources available to provision a server on these plans.</span>
              </div>
            ) : (
              blocks.map((b) => (
                <div key={b.message} className="flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500 mt-px" />
                  <span>{b.message}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {isShrink && (
        <div className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-900 rounded p-2.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>
            Reducing memory or storage shrinks the disk. The guest has to fit inside the smaller volume, and resizing
            back up afterwards does not restore anything lost.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-[#495057] dark:text-slate-300">
          {selected ? (
            <>
              New monthly total <span className="font-semibold">${total.toFixed(2)}</span>{' '}
              <span className="text-[#6c757d] dark:text-slate-400">(incl. ${gst.toFixed(2)} GST)</span>
            </>
          ) : (
            <span className="text-[#6c757d] dark:text-slate-400">Select a plan to see the new monthly total.</span>
          )}
        </p>
        <button
          type="button"
          disabled={busy || !selected || unchanged}
          onClick={() =>
            selected &&
            onApply(
              { type: 'resize', size: selected.slug, options: { memory, disk } },
              `Change plan to ${selected.slug} (${memory / 1024} GB memory, ${disk} GB storage)`,
              [
                { label: 'Plan', from: server.size_slug ?? undefined, to: selected.slug },
                { label: 'Memory', from: `${(server.memory ?? 0) / 1024} GB`, to: `${memory / 1024} GB` },
                { label: 'Storage', from: `${server.disk ?? 0} GB`, to: `${disk} GB` },
                // Both sides ex-GST and both including the image surcharge:
                // `size.price_monthly` alone is the bare plan price and `total`
                // is inc-GST, so comparing those understated the current cost.
                ...(server.size ? [{ label: 'Monthly (ex-GST)', from: `$${planMonthlyPrice(server.size, image, server.memory ?? 0, server.disk ?? 0).toFixed(2)}`, to: `$${monthly.toFixed(2)}` }] : [])
              ].filter((c) => c.from !== c.to)
            )
          }
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-[#017cb6] text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
          <span>{unchanged ? 'No change selected' : 'Change Plan'}</span>
        </button>
      </div>
    </div>
  )
}
