import React from 'react'
import { Network } from 'lucide-react'
import { BinaryLaneClient } from '../../api/client'
import { useVpcs } from '../../api/queries'

/**
 * A server's VPC, shown the way the web panel shows it: the network's name with
 * a network glyph, not its numeric id.
 *
 * "VPC #4213" told the reader nothing - the id is an internal handle, and the
 * name is what the same network is called everywhere else in the app. The id is
 * kept only as a fallback for the window before /v2/vpcs resolves, or if the
 * network is no longer readable.
 */
export const VpcBadge: React.FC<{
  vpcId?: number | null
  client: BinaryLaneClient | null
  className?: string
}> = ({ vpcId, client, className = '' }) => {
  const vpcsQuery = useVpcs(client)
  if (!vpcId) return null
  const vpc = (vpcsQuery.data ?? []).find((v) => v.id === vpcId)
  return (
    <span className={`inline-flex items-center gap-1.5 min-w-0 ${className}`}>
      <Network className="w-3.5 h-3.5 shrink-0 text-fg-link" />
      <span className="truncate">{vpc?.name ?? `VPC #${vpcId}`}</span>
    </span>
  )
}
