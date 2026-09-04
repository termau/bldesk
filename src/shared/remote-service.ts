export interface RemoteServiceProbe {
  kind: 'ssh' | 'rdp'
  label: 'SSH' | 'RDP'
  port: 22 | 3389
}

interface ProbeImage {
  distribution?: string | null
  name?: string | null
  full_name?: string | null
  slug?: string | null
  distribution_info?: { features?: readonly string[] | null } | null
}

/**
 * Pick the guest's normal remote-management service for a local TCP check.
 * Distribution features are authoritative for current API payloads; the text
 * fallback keeps backups and older/custom image records useful when that
 * metadata is absent.
 */
export function remoteServiceProbeForImage(image?: ProbeImage | null): RemoteServiceProbe {
  const features = Array.isArray(image?.distribution_info?.features)
    ? image.distribution_info.features
    : []
  const description = [image?.distribution, image?.full_name, image?.name, image?.slug]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
  const supportsRdp = features.includes('remote-desktop') ||
    (!features.includes('ssh') && /windows/i.test(description))
  return supportsRdp
    ? { kind: 'rdp', label: 'RDP', port: 3389 }
    : { kind: 'ssh', label: 'SSH', port: 22 }
}
