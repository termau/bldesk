/**
 * The accessible name of a plan's radio in the Create Server and Change Plan tables: what the row shows, as one line.
 *
 * The radios used to be named by their whole row (aria-labelledby on the <tr>), but on the chosen row the Memory and
 * Storage cells hold selects, and the row's name then read their labels ("Memory", "Storage") in place of the sizes.
 * Built from the same figures the row shows, the chosen memory and disk included.
 */
export function planRadioName(plan: { vcpus: number; vcpu_units?: string | null; transfer: number }, memoryMb: number, diskGb: number, monthly?: number): string {
  const cpus = `${plan.vcpus} ${plan.vcpu_units || 'VCPU'}${plan.vcpus === 1 ? '' : 's'}`
  const parts = [cpus, `${memoryMb / 1024} GB memory`, `${diskGb} GB storage`, `${plan.transfer * 1000} GB transfer`]
  if (monthly !== undefined) parts.push(`$${monthly.toFixed(2)} a month`)
  return parts.join(', ')
}
