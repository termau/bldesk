import { HelpLink } from '../ui/HelpLink'
import React, { useState } from 'react'
import {
  Receipt,
  DollarSign,
  ArrowUpRight,
  Download,
  CheckCircle,
  AlertTriangle,
  Database,
  CreditCard,
  Clock,
  Repeat,
  ExternalLink,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { BinaryLaneClient } from '../../api/client'
import { useAccount, useBalance, useInvoices, useUnpaidInvoices, useDataUsage } from '../../api/queries'
import { MPANEL_URL } from '../ui/LinkOut'

/**
 * Billing, laid out the way mPanel does it: a summary strip, then tabs for
 * Pending Charges / Invoices / Payment Details.
 *
 * Pending charges come from `balance.charges` — the per-item breakdown behind
 * `unbilled_total`, which was previously fetched and discarded in favour of the
 * total alone. Payment Details is read-only: the API reports which payment method
 * *types* are configured and nothing more, so changing them links out to mPanel.
 */

const MPANEL = MPANEL_URL

type BillingTab = 'pending' | 'invoices' | 'payment'

interface BillingOverviewProps {
  client: BinaryLaneClient | null
}

export const BillingOverview: React.FC<BillingOverviewProps> = ({ client }) => {
  const [tab, setTab] = useState<BillingTab>('pending')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)

  const accountQuery = useAccount(client)
  const balanceQuery = useBalance(client)
  const invoicesQuery = useInvoices(client, page, perPage)
  const unpaidQuery = useUnpaidInvoices(client)
  const dataUsageQuery = useDataUsage(client)

  const account = accountQuery.data as any
  const balance = balanceQuery.data as any
  const invoices = (invoicesQuery.data?.invoices || []) as any[]
  const invoiceTotal = invoicesQuery.data?.total ?? 0
  const unpaid = (unpaidQuery.data || []) as any[]
  const dataUsages = dataUsageQuery.data || []

  const charges = (balance?.charges || []) as any[]

  // A figure that has not loaded shows a dash; one whose read finished without it says so. Neither may read as zero
  // dollars or a zero allowance. If a refresh fails, the last figure that did load stays on screen.
  const credit = balance?.available_credit
  const unbilled = balance?.unbilled_total
  const creditFailed = !balanceQuery.isPending && typeof credit !== 'number'
  const unbilledFailed = !balanceQuery.isPending && typeof unbilled !== 'number'
  const usageKnown = dataUsageQuery.data != null
  const usageFailed = !usageKnown && !dataUsageQuery.isPending

  // Transfer added up over every server in the list. Each row is one server's included transfer and use in that server's own
  // current period. The reference gives no rule for when pooling applies and no "unlimited" value, so the card claims neither.
  const totalAllocatedGb = dataUsages.reduce((acc: number, u: any) => acc + (u.transfer_gigabytes || 0), 0)
  const totalUsedGb = dataUsages.reduce((acc: number, u: any) => acc + (u.current_transfer_usage_gigabytes || 0), 0)

  const handleDownloadInvoice = (invoice: any) => {
    if (invoice.invoice_view_url || invoice.download_url) {
      window.bldeskApi?.openExternal?.(invoice.invoice_view_url || invoice.download_url)
    } else {
      window.bldeskApi?.openExternal?.(`${MPANEL}/billing`)
    }
  }

  const tabs: { id: BillingTab; label: string; badge?: number }[] = [
    { id: 'pending', label: 'Pending Charges', badge: charges.length || undefined },
    { id: 'invoices', label: 'Invoices' },
    { id: 'payment', label: 'Payment Details' }
  ]

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto select-text bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa]">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#212529] dark:text-white flex items-center gap-2.5">
          <Receipt className="w-5 h-5 text-fg-link" />
          <span className="flex-1">Usage, Billing &amp; Invoices</span>
          <HelpLink slug="billing" />
        </h1>
        <p className="text-xs text-fg-muted dark:text-slate-400 mt-0.5">
          Real-time account balance, data transfer, and tax invoice history.
        </p>
      </div>

      {/* A failed check must not read as "nothing unpaid": say that it could not be made. */}
      {unpaidQuery.isError && !unpaidQuery.data && (
        <div role="alert" className="flex items-center gap-2 text-[0.6875rem] text-rose-700 dark:text-rose-300">
          <span>Couldn't check whether any invoices are unpaid.</span>
          <button onClick={() => void unpaidQuery.refetch()} disabled={unpaidQuery.isFetching} className="underline disabled:opacity-60">
            Retry
          </button>
        </div>
      )}

      {/* Payment-failed warning: worth surfacing above everything else */}
      {unpaid.length > 0 && (
        <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold">
              {unpaid.length} invoice{unpaid.length === 1 ? '' : 's'} unpaid after a failed payment attempt
            </div>
            <div className="opacity-80 mt-0.5">
              Totalling ${unpaid.reduce((a, i) => a + (i.amount || 0), 0).toFixed(2)} AUD.
            </div>
          </div>
          <button
            onClick={() => window.bldeskApi?.openExternal?.(`${MPANEL}/billing`)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 font-medium transition flex-shrink-0"
          >
            Pay in mPanel
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Top 3 Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Account Balance Card */}
        <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg p-4 space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-xs text-fg-muted dark:text-slate-400">
            <span>Available Credit</span>
            <DollarSign className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-[#212529] dark:text-white font-mono">
            {typeof credit === 'number' ? `$${credit.toFixed(2)} AUD` : <span className="text-[#adb5bd]">—</span>}
          </div>
          {creditFailed ? (
            <div className="text-[0.6875rem] text-rose-700 dark:text-rose-300">Couldn't load the account balance.</div>
          ) : (
            <div className="text-[0.6875rem] text-fg-muted">Current balance available on account</div>
          )}
        </div>

        {/* Unbilled Charges Forecast */}
        <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg p-4 space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-xs text-fg-muted dark:text-slate-400">
            <span>Pending Charges</span>
            <ArrowUpRight className="w-4 h-4 text-fg-link" />
          </div>
          <div className="text-2xl font-bold text-[#212529] dark:text-white font-mono">
            {typeof unbilled === 'number' ? `$${unbilled.toFixed(2)} AUD` : <span className="text-[#adb5bd]">—</span>}
          </div>
          {unbilledFailed ? (
            <div className="text-[0.6875rem] text-rose-700 dark:text-rose-300">Couldn't load the pending charges.</div>
          ) : (
            <div className="text-[0.6875rem] text-fg-muted">Current billing cycle accrued usage</div>
          )}
        </div>

        {/* Data transfer, all servers */}
        <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg p-4 space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-xs text-fg-muted dark:text-slate-400">
            <span>Data Transfer</span>
            <Database className="w-4 h-4 text-fg-link" />
          </div>
          <div className="text-2xl font-bold text-[#212529] dark:text-white font-mono">
            {usageKnown ? (
              `${totalUsedGb.toFixed(1)} / ${totalAllocatedGb} GB`
            ) : (
              <span className="text-[#adb5bd]">—</span>
            )}
          </div>
          <div className="w-full bg-[#ced4da] dark:bg-[#343a40] h-1.5 rounded-full overflow-hidden mt-1">
            <div
              className="bg-[#017cb6] h-full"
              style={{
                width: `${!usageKnown ? 0 : totalAllocatedGb > 0 ? Math.min(100, (totalUsedGb / totalAllocatedGb) * 100) : totalUsedGb > 0 ? 100 : 0}%`
              }}
            />
          </div>
          {usageFailed && (
            <div className="text-[0.6875rem] text-rose-700 dark:text-rose-300">Couldn't load the data transfer usage.</div>
          )}
          {usageKnown && (
            <div className="text-[0.6875rem] text-fg-muted">
              {dataUsages.length === 0
                ? "BinaryLane's transfer list has no servers."
                : `Used / included across ${dataUsages.length} server${dataUsages.length === 1 ? '' : 's'}, each for its own current period`}
            </div>
          )}
        </div>
      </div>

      {/* Tabbed detail */}
      <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg shadow-sm overflow-hidden flex flex-col flex-shrink-0">
        <div className="flex items-center gap-1 px-2 pt-2 bg-[#f1f1f1] dark:bg-[#262a2e] border-b border-[#ced4da] dark:border-[#373b3e]">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t transition border-b-2 -mb-px ${
                tab === t.id
                  ? 'border-[#017cb6] text-fg-link dark:text-[#4db2e0] bg-white dark:bg-[#2b3035]'
                  : 'border-transparent text-fg-muted dark:text-[#adb5bd] hover:text-[#212529] dark:hover:text-white'
              }`}
            >
              {t.label}
              {t.badge != null && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#017cb6]/15 text-fg-link dark:text-[#4db2e0] text-[0.625rem]">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === 'pending' && (
          <PendingCharges
            charges={charges}
            isLoading={balanceQuery.isPending}
            failed={!balanceQuery.isPending && !balance}
            generatedAt={balance?.generated_at}
          />
        )}

        {tab === 'invoices' && (
          <Invoices
            invoices={invoices}
            total={invoiceTotal}
            page={page}
            perPage={perPage}
            isLoading={invoicesQuery.isLoading}
            isFetching={invoicesQuery.isFetching}
            failed={invoicesQuery.isError}
            onRetry={() => void invoicesQuery.refetch()}
            onOpen={handleDownloadInvoice}
            onPageChange={setPage}
            onPerPageChange={(n) => {
              setPerPage(n)
              setPage(1)
            }}
          />
        )}

        {tab === 'payment' && (
          <PaymentDetails
            account={account}
            isLoading={accountQuery.isPending && accountQuery.fetchStatus !== 'idle'}
            failed={accountQuery.isError && !account}
            onRetry={() => void accountQuery.refetch()}
          />
        )}
      </div>
    </div>
  )
}

// --- Pending Charges ---

const PendingCharges: React.FC<{ charges: any[]; isLoading: boolean; failed: boolean; generatedAt?: string }> = ({
  charges,
  isLoading,
  failed,
  generatedAt
}) => {
  if (isLoading) return <Empty>Loading pending charges...</Empty>
  if (failed) return <Empty>Couldn't load the pending charges.</Empty>
  if (charges.length === 0) return <Empty>No pending charges for the current billing cycle.</Empty>

  const total = charges.reduce((a, c) => a + (c.total || 0), 0)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs border-collapse">
        <thead>
          <tr className="bg-[#f8f9fa] dark:bg-[#212529] border-b border-[#ced4da] dark:border-[#373b3e] text-fg-muted">
            <th className="py-2.5 px-4">Description</th>
            <th className="py-2.5 px-4">Created</th>
            <th className="py-2.5 px-4">Type</th>
            <th className="py-2.5 px-4 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
          {charges.map((c, i) => (
            <tr key={i} className="hover:bg-[#f8f9fa] dark:hover:bg-[#32383e] transition">
              <td className="py-3 px-4 text-[#212529] dark:text-white">{c.description || '—'}</td>
              <td className="py-3 px-4 text-fg-muted dark:text-slate-300">
                {c.created ? new Date(c.created).toLocaleDateString() : '—'}
              </td>
              <td className="py-3 px-4">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[0.625rem] font-semibold ${
                    c.ongoing
                      ? 'bg-[#017cb6]/10 text-fg-link dark:text-[#4db2e0]'
                      : 'bg-black/5 dark:bg-white/10 text-fg-muted dark:text-[#adb5bd]'
                  }`}
                >
                  {c.ongoing ? <Repeat className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  {c.ongoing ? 'Ongoing' : 'Awaiting invoicing'}
                </span>
              </td>
              <td className="py-3 px-4 text-right font-mono font-semibold text-[#212529] dark:text-white">
                ${(c.total || 0).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[#f8f9fa] dark:bg-[#212529] border-t border-[#ced4da] dark:border-[#373b3e]">
            <td className="py-2.5 px-4 font-semibold text-[#495057] dark:text-[#ced4da]" colSpan={3}>
              Total pending
              {generatedAt && (
                <span className="font-normal text-fg-muted ml-2">
                  as at {new Date(generatedAt).toLocaleString()}
                </span>
              )}
            </td>
            <td className="py-2.5 px-4 text-right font-mono font-bold text-[#212529] dark:text-white">
              ${total.toFixed(2)} AUD
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

const FailedLoad: React.FC<{ message: string; onRetry: () => void; busy?: boolean }> = ({ message, onRetry, busy }) => (
  <div role="alert" className="p-8 text-center text-xs space-y-2">
    <div className="text-rose-700 dark:text-rose-300">{message}</div>
    <button
      onClick={onRetry}
      disabled={busy}
      className="px-3 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white rounded font-medium transition disabled:opacity-60"
    >
      Retry
    </button>
  </div>
)

// --- Invoices ---

const PER_PAGE_OPTIONS = [20, 50, 100, 200]

const Invoices: React.FC<{
  invoices: any[]
  total: number
  page: number
  perPage: number
  isLoading: boolean
  isFetching: boolean
  failed: boolean
  onRetry: () => void
  onOpen: (inv: any) => void
  onPageChange: (p: number) => void
  onPerPageChange: (n: number) => void
}> = ({ invoices, total, page, perPage, isLoading, isFetching, failed, onRetry, onOpen, onPageChange, onPerPageChange }) => {
  if (isLoading) return <Empty>Loading invoices...</Empty>
  // A failed read is not "no invoices": a customer with invoices must not be told there are none.
  if (failed && invoices.length === 0) return <FailedLoad message="Couldn't load the invoices." onRetry={onRetry} busy={isFetching} />
  if (invoices.length === 0 && page === 1) return <Empty>No past invoices found.</Empty>

  const lastPage = Math.max(1, Math.ceil(total / perPage))
  const first = (page - 1) * perPage + 1
  const last = Math.min(page * perPage, total)

  return (
    <>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs border-collapse">
        <thead>
          <tr className="bg-[#f8f9fa] dark:bg-[#212529] border-b border-[#ced4da] dark:border-[#373b3e] text-fg-muted">
            <th className="py-2.5 px-4">Invoice #</th>
            <th className="py-2.5 px-4">Date</th>
            <th className="py-2.5 px-4">Amount</th>
            <th className="py-2.5 px-4">Status</th>
            <th className="py-2.5 px-4 text-right">PDF</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
          {invoices.map((inv: any) => {
            const isPaid = inv.paid ?? true
            return (
              <tr key={inv.invoice_id} className="hover:bg-[#f8f9fa] dark:hover:bg-[#32383e] transition">
                <td className="py-3 px-4 font-mono font-bold text-fg-link">
                  {inv.invoice_number || `#${inv.invoice_id}`}
                </td>
                <td className="py-3 px-4 text-fg-muted dark:text-slate-300">
                  {inv.created ? new Date(inv.created).toLocaleDateString() : '—'}
                </td>
                <td className="py-3 px-4 font-mono font-semibold text-[#212529] dark:text-white">
                  ${(inv.amount || 0).toFixed(2)} AUD
                </td>
                <td className="py-3 px-4">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[0.625rem] font-semibold ${
                      isPaid
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    {isPaid ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    <span>{isPaid ? 'Paid' : 'Unpaid'}</span>
                  </span>
                </td>
                <td className="py-3 px-4 text-right">
                  <button
                    onClick={() => onOpen(inv)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-fg-link hover:bg-[#017cb6]/10 rounded transition"
                    title="Open Tax Invoice in Browser"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>View</span>
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>

    {/* Pager. per_page defaults to 20 server-side and caps at 200. */}
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-[#ced4da] dark:border-[#373b3e] bg-[#f8f9fa] dark:bg-[#212529] text-[0.6875rem]">
      <div className="flex items-center gap-2 text-fg-muted dark:text-[#adb5bd]">
        <span>
          {total > 0 ? `Showing ${first}–${last} of ${total}` : `Showing ${invoices.length}`}
        </span>
        {isFetching && <span className="opacity-60">updating...</span>}
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-fg-muted dark:text-[#adb5bd]">
          <span>Per page</span>
          <select
            value={perPage}
            onChange={(e) => onPerPageChange(Number(e.target.value))}
            className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded px-1.5 py-0.5 text-[#212529] dark:text-white outline-none"
          >
            {PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <PagerButton disabled={page <= 1} onClick={() => onPageChange(page - 1)} label="Previous page">
            <ChevronLeft className="w-3.5 h-3.5" />
          </PagerButton>
          <span className="px-2 text-fg-muted dark:text-[#adb5bd] font-mono">
            {page} / {lastPage}
          </span>
          <PagerButton disabled={page >= lastPage} onClick={() => onPageChange(page + 1)} label="Next page">
            <ChevronRight className="w-3.5 h-3.5" />
          </PagerButton>
        </div>
      </div>
    </div>
    </>
  )
}

const PagerButton: React.FC<{
  disabled: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}> = ({ disabled, onClick, label, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    className="p-1 rounded border border-[#ced4da] dark:border-[#373b3e] text-[#495057] dark:text-[#ced4da] hover:bg-[#017cb6]/10 hover:border-[#017cb6] transition disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-[#ced4da] dark:disabled:hover:border-[#373b3e]"
  >
    {children}
  </button>
)

// --- Payment Details ---

const PaymentDetails: React.FC<{ account: any; isLoading: boolean; failed: boolean; onRetry: () => void }> = ({ account, isLoading, failed, onRetry }) => {
  if (isLoading) return <Empty>Loading payment details...</Empty>
  // A failed account read is not "no payment method": a customer with one saved must not be told there is none.
  if (failed) return <FailedLoad message="Couldn't load the payment details." onRetry={onRetry} />

  const methods: string[] = account?.configured_payment_methods || []
  const label = (m: string) => (m === 'paypal' ? 'PayPal' : m === 'credit-card' ? 'Credit card' : m)
  const isPaypal = methods.includes('paypal')

  return (
    <div className="p-4 space-y-4 text-xs">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-fg-muted dark:text-[#adb5bd]">Payment method</div>
          {methods.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {methods.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#017cb6]/10 text-fg-link dark:text-[#4db2e0] font-semibold"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  {label(m)}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-[#adb5bd]">No payment method configured</div>
          )}
        </div>

        <button
          onClick={() => window.bldeskApi?.openExternal?.(`${MPANEL}/billing/payment-details`)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white rounded font-medium transition flex-shrink-0"
        >
          Change Billing Details
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {isPaypal && (
        <div className="flex items-start gap-2 p-3 rounded border border-[#ced4da] dark:border-[#373b3e] bg-[#f8f9fa] dark:bg-[#212529] text-fg-muted dark:text-[#adb5bd] leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-[#f1ca00]" />
          <span>
            PayPal is not charged automatically — each invoice has to be paid manually from the
            invoice list.
          </span>
        </div>
      )}
    </div>
  )
}

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="p-8 text-center text-xs text-fg-muted">{children}</div>
)
