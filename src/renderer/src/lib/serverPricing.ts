/**
 * Pricing and availability for the create-server form.
 *
 * A plan's `price_monthly` is the base only. Licensed images add a surcharge that
 * the web panel folds into the displayed price, so showing `price_monthly` alone
 * understates Windows by roughly half.
 *
 * Derived from the published figures and confirmed against them:
 *
 *   Windows Server 2025 (surcharge_per_memory_megabyte 0.0048828125, capped at 8192 MB)
 *     std-1vcpu   2048 MB    9.80 + 2048*0.0048828125 =  19.80
 *     std-2vcpu   4096 MB   19.60 + 4096*0.0048828125 =  39.60
 *     std-4vcpu   8192 MB   39.20 + 8192*0.0048828125 =  79.20
 *     std-6vcpu  16384 MB   78.40 + 8192*0.0048828125 = 118.40   (capped)
 *     std-8vcpu  32768 MB  156.80 + 8192*0.0048828125 = 196.80   (capped)
 *
 *   cPanel+WHM  surcharge_base_cost 40  ->  flat +40.00
 */

export interface DistributionSurcharges {
  surcharge_base_cost?: number | null
  surcharge_per_memory_megabyte?: number | null
  surcharge_per_memory_max_megabytes?: number | null
  surcharge_per_vcpu?: number | null
  surcharge_min_vcpu?: number | null
}

export interface SizeLike {
  slug: string
  memory: number
  disk: number
  vcpus: number
  vcpu_units?: string | null
  transfer: number
  storage_description?: string | null
  cpu_description?: string | null
  price_monthly: number
  available?: boolean
  regions?: string[] | null
  regions_out_of_stock?: string[] | null
  size_type?: { slug?: string; name?: string } | null
  options?: Record<string, any> | null
}

export interface ImageLike {
  slug?: string | null
  distribution?: string | null
  min_disk_size?: number | null
  min_memory_megabytes?: number | null
  regions?: string[] | null
  distribution_surcharges?: DistributionSurcharges | null
}

/** Image surcharge for a given amount of memory and vCPU count. */
export function imageSurcharge(image: ImageLike | undefined, memoryMb: number, vcpus: number): number {
  const s = image?.distribution_surcharges
  if (!s) return 0
  let total = s.surcharge_base_cost || 0
  if (s.surcharge_per_memory_megabyte) {
    const cap = s.surcharge_per_memory_max_megabytes ?? memoryMb
    total += Math.min(memoryMb, cap) * s.surcharge_per_memory_megabyte
  }
  if (s.surcharge_per_vcpu) {
    // Licensing that scales with cores is billed from a floor, not from zero.
    const billable = Math.max(vcpus, s.surcharge_min_vcpu ?? 0)
    total += billable * s.surcharge_per_vcpu
  }
  return total
}

/** Monthly price of a plan including any image surcharge, at the chosen memory/disk. */
export function planMonthlyPrice(
  size: SizeLike,
  image: ImageLike | undefined,
  memoryMb: number,
  diskGb: number
): number {
  const o = size.options || {}
  const extraMemory = Math.max(0, memoryMb - size.memory) * (o.memory_cost_per_additional_megabyte || 0)
  const extraDisk = Math.max(0, diskGb - size.disk) * (o.disk_cost_per_additional_gigabyte || 0)
  return size.price_monthly + extraMemory + extraDisk + imageSurcharge(image, memoryMb, size.vcpus)
}

/**
 * Why a plan can't be used right now, or null when it can.
 *
 * `available` is the plan being offered at all; `regions_out_of_stock` is the
 * per-region capacity that the web panel greys rows out for. An image's minimums
 * exclude plans too, which is why Windows shows five rows where Ubuntu shows six.
 */
/**
 * Why a plan can't be used right now, or null when it can.
 *
 * Typed rather than a bare string because the cause changes the wording the web
 * panel uses: capacity is "we currently do not have resources available", while
 * an image minimum is a property of the chosen OS and must say so instead.
 */
export type PlanBlockKind = 'retired' | 'region' | 'stock' | 'memory' | 'disk'
export interface PlanBlock {
  kind: PlanBlockKind
  message: string
}

export function planUnavailableReason(
  size: SizeLike,
  region: string,
  image: ImageLike | undefined
): PlanBlock | null {
  if (size.available === false) return { kind: 'retired', message: 'This plan is no longer offered.' }
  if (size.regions && !size.regions.includes(region)) {
    return { kind: 'region', message: 'Not offered in this region.' }
  }
  if (size.regions_out_of_stock?.includes(region)) {
    return { kind: 'stock', message: 'Out of stock in this region.' }
  }
  if (image?.min_memory_megabytes && size.memory < image.min_memory_megabytes) {
    return {
      kind: 'memory',
      message: `${image.distribution || 'This image'} needs at least ${image.min_memory_megabytes / 1024} GB memory.`
    }
  }
  if (image?.min_disk_size && (size.options?.disk_max ?? size.disk) < image.min_disk_size) {
    return {
      kind: 'disk',
      message: `${image.distribution || 'This image'} needs at least ${image.min_disk_size} GB storage.`
    }
  }
  return null
}

/** True when a block is about capacity rather than the chosen image. */
export const isCapacityBlock = (b: PlanBlock): boolean =>
  b.kind === 'stock' || b.kind === 'region' || b.kind === 'retired'

/** Selectable memory steps for a plan: doubling from the included amount to the cap. */
export function memoryChoices(size: SizeLike): number[] {
  const max = size.options?.memory_max ?? size.memory
  const out: number[] = []
  for (let m = size.memory; m <= max; m *= 2) out.push(m)
  if (!out.includes(max)) out.push(max)
  return out
}

/**
 * The web panel's storage ladder: 5 GB steps to 60, then 10 GB to 200, then
 * 100 GB to 2000. Taken from mPanel's own <option> list rather than derived, so
 * the two agree exactly - a generated step produced values mPanel never offers.
 */
function diskLadder(): number[] {
  const out: number[] = []
  for (let d = 20; d < 60; d += 5) out.push(d)
  for (let d = 60; d < 200; d += 10) out.push(d)
  for (let d = 200; d <= 2000; d += 100) out.push(d)
  return out
}

/** Selectable storage steps, honouring restricted_disk_values where a plan sets them. */
export function diskChoices(size: SizeLike): number[] {
  const o = size.options || {}
  if (Array.isArray(o.restricted_disk_values) && o.restricted_disk_values.length) {
    return o.restricted_disk_values as number[]
  }
  const min = size.disk
  const max = o.disk_max ?? size.disk
  if (min >= max) return [min]
  const steps = diskLadder().filter((d) => d >= min && d <= max)
  if (!steps.includes(min)) steps.unshift(min)
  if (!steps.includes(max)) steps.push(max)
  return steps
}

/**
 * Every monthly component of a configured server, ex-GST.
 *
 * Extracted from the create form so Change Plan bills the same way - Change Plan
 * previously showed `planMonthlyPrice` alone, ignoring addresses, retention and
 * licences - and then corrected, because the create form's own version was
 * wrong in three ways. Sharing a formula makes two screens agree; it does not
 * make them right.
 *
 *   backups   priced per frequency against the count the plan already includes,
 *             not on the raw total. `SizeOptions.{daily,weekly,monthly}_backups`
 *             are inclusions, so charging for all of them overcharges any plan
 *             that bundles some.
 *   offsite   the per-GB rate on the raw selected count - inclusions are not
 *             deducted here, unlike on-site - plus a one-off per-GB surcharge
 *             for the first enabled frequency in daily, weekly, monthly order.
 *             Both quirks are the web panel's, verified against its source.
 *   transfer  charged per GB above the plan's included allowance.
 *
 * None of the three currently moves a number on the 21 offered sizes: every one
 * includes zero backups, publishes zero for all three offsite frequency rates,
 * and sets `transfer_max` equal to its included transfer. They are correctness
 * rather than a live mischarge - which is exactly why they were easy to get
 * wrong and would have stayed wrong until a plan changed shape.
 */
export interface ConfiguredCost {
  plan: number
  memory: number
  disk: number
  surcharge: number
  addresses: number
  backups: number
  offsite: number
  transfer: number
  licences: number
  total: number
}

export interface ConfiguredCostInput {
  size: SizeLike
  image?: ImageLike
  memoryMb: number
  diskGb: number
  ipCount: number
  dailyBackups: number
  weeklyBackups: number
  monthlyBackups: number
  offsiteBackups: boolean
  /** Total monthly transfer in TB. Defaults to the plan's included allowance. */
  transferTb?: number
  /** Monthly ex-GST cost of the selected licences, if any. */
  licencesMonthly?: number
}

export function configuredCost(i: ConfiguredCostInput): ConfiguredCost {
  const o = i.size.options || {}
  const memory = Math.max(0, i.memoryMb - i.size.memory) * (o.memory_cost_per_additional_megabyte || 0)
  const disk = Math.max(0, i.diskGb - i.size.disk) * (o.disk_cost_per_additional_gigabyte || 0)
  const surcharge = imageSurcharge(i.image, i.memoryMb, i.size.vcpus)
  const addresses = Math.max(0, i.ipCount - 1) * (o.ipv4_addresses_cost_per_address || 0)

  // Only retention beyond what the plan bundles is chargeable.
  const chargeable =
    Math.max(0, i.dailyBackups - (o.daily_backups || 0)) +
    Math.max(0, i.weeklyBackups - (o.weekly_backups || 0)) +
    Math.max(0, i.monthlyBackups - (o.monthly_backups || 0))
  const backups = chargeable * i.diskGb * (o.backups_cost_per_backup_per_gigabyte || 0)

  const selectedBackups = i.dailyBackups + i.weeklyBackups + i.monthlyBackups
  let offsite = 0
  if (i.offsiteBackups && selectedBackups > 0) {
    const f = o.offsite_backup_frequency_cost || {}
    /*
     * The frequency surcharge is one rate, chosen by *priority* - daily, else
     * weekly, else monthly - and not by `Math.max`.
     *
     * The API documents it as "only the highest value of the daily, weekly and
     * monthly is applied", and this originally implemented that literally.
     * mPanel instead charges the first enabled frequency in that fixed order.
     * The two agree only while
     * daily >= weekly >= monthly, which is how the rates are published today,
     * so they cannot be told apart from the live API - every offered size
     * publishes 0.0 for all three. Matching the panel is what matters: a
     * customer comparing the two screens must see the same figure, even if the
     * rates are ever published out of that order.
     */
    const frequencyRate = i.dailyBackups
      ? f.daily_per_gigabyte || 0
      : i.weeklyBackups
        ? f.weekly_per_gigabyte || 0
        : f.monthly_per_gigabyte || 0
    /*
     * The per-GB storage term multiplies the *raw* retention total, including
     * what the plan bundles - deliberately unlike the on-site term above, which
     * subtracts inclusions. This matches mPanel, which charges for the selected
     * counts with no subtraction.
     */
    offsite = selectedBackups * i.diskGb * (o.offsite_backups_cost_per_gigabyte || 0) + frequencyRate * i.diskGb
  }

  const transferTb = i.transferTb ?? i.size.transfer
  const transfer = Math.max(0, transferTb - i.size.transfer) * 1000 * (o.transfer_cost_per_additional_gigabyte || 0)

  const licences = i.licencesMonthly || 0
  return {
    plan: i.size.price_monthly,
    memory,
    disk,
    surcharge,
    addresses,
    backups,
    offsite,
    transfer,
    licences,
    total: i.size.price_monthly + memory + disk + surcharge + addresses + backups + offsite + transfer + licences
  }
}

/**
 * The transfer allowance to send with a resize.
 *
 * `resize` resets any resource option the payload omits to the target plan's
 * default, so this has to be sent explicitly to be meaningful at all.
 *
 * The rule is mPanel's, not a clamp: changing to a different base plan hands
 * the customer the *target plan's* included transfer, while keeping the same
 * plan keeps whatever they had. The API behaves the same way, resetting
 * additional transfer to zero on a plan change and accepting the target plan's
 * base.
 *
 * An earlier version clamped the existing value into the target's range
 * instead. That happens to give the same answer today - no offered size has
 * `transfer_max` above its included transfer - but it would have preserved a
 * larger allowance the panel discards, on any plan that ever allows topping it
 * up.
 *
 * The same-size path is still bounded, because the API rejects anything above
 * the plan's maximum outright:
 *   400 options.transfer: "Transfer upgrades are not supported by this size."
 */
export function transferForResize(
  targetSize: SizeLike,
  currentTransferTb: number | null | undefined,
  sizeChanged: boolean
): number {
  if (sizeChanged) return targetSize.transfer
  const max = targetSize.options?.transfer_max ?? targetSize.transfer
  const wanted = currentTransferTb ?? targetSize.transfer
  return Math.min(Math.max(wanted, targetSize.transfer), max)
}

/**
 * Backup retention wording, matching the web panel exactly.
 *
 *   0  "Do not take a daily backup"
 *   1  "Take daily backups, stored for 1 day (+$2.00 per month)"
 *   3  "Take daily backups, stored for 3 days (+$6.00 per month)"
 *
 * Weekly and monthly use their own units ("2 weeks", "10 months"). Change Plan
 * previously said "Keep 3" with no unit and no price, and the create form said
 * "periods" for weekly and monthly - two different drifts from the panel
 * customers already know, which is why this is shared rather than inlined.
 *
 * The price subtracts retention the plan already includes, so the label cannot
 * disagree with the billing summary beneath it.
 */
const RETENTION_UNIT: Record<'daily' | 'weekly' | 'monthly', string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month'
}

export function retentionOptionLabel(
  frequency: 'daily' | 'weekly' | 'monthly',
  count: number,
  diskGb: number,
  size: SizeLike | undefined
): string {
  if (count === 0) return `Do not take a ${frequency} backup`
  const o = size?.options || {}
  const included = (o[`${frequency}_backups`] as number) || 0
  const cost = Math.max(0, count - included) * diskGb * (o.backups_cost_per_backup_per_gigabyte || 0)
  const unit = RETENTION_UNIT[frequency] + (count === 1 ? '' : 's')
  return `Take ${frequency} backups, stored for ${count} ${unit} (+$${cost.toFixed(2)} per month)`
}

export const GST_RATE = 0.1

/** Monthly total shown in the billing summary, inclusive of GST. */
export function billingTotal(monthlyExGst: number): { total: number; gst: number } {
  const gst = monthlyExGst * GST_RATE
  return { total: monthlyExGst + gst, gst }
}

/**
 * Order image versions the way the web panel presents them: newest first, with a
 * base release ahead of its licensed variants.
 *
 * The API returns images in no meaningful order (AlmaLinux 10, 8, 9 ... Ubuntu
 * 22.04, 24.04, 26.04 ... then 20.04.6 and 22.04 Desktop much later), so the
 * order has to be imposed here. This is presentation only — nothing depends on it.
 *
 * Matches the published lists:
 *   Ubuntu   26.04 LTS, 24.04 LTS, 22.04 LTS, 22.04 Desktop, 20.04.6 LTS
 *   Windows  Server 2025, Server 2022, 2022 + SQL Standard, 2022 + SQL Web,
 *            Server 2019, 2019 + SQL Standard, 2019 + SQL Web, Server 2016, ...
 */
export function compareVersionNames(a: string, b: string): number {
  const versionOf = (s: string) => {
    const m = s.match(/(\d+(?:\.\d+)*)/)
    if (!m) return [] as number[]
    return m[1].split('.').map(Number)
  }
  const va = versionOf(a)
  const vb = versionOf(b)
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (vb[i] ?? 0) - (va[i] ?? 0) // descending: newest first
    if (d !== 0) return d
  }
  // Same release: long-term support ahead of desktop or other spins.
  const lts = (s: string) => (/LTS/i.test(s) ? 0 : 1)
  if (lts(a) !== lts(b)) return lts(a) - lts(b)
  // Base release ahead of "+ SQL Server ..." style variants.
  const variant = (s: string) => (s.includes('+') ? 1 : 0)
  if (variant(a) !== variant(b)) return variant(a) - variant(b)
  return a.localeCompare(b)
}
