---
title: DNS
summary: Manage hosted zones and records, with export before zone removal.
keywords: [dns, zone, record, ttl, a, aaaa, cname, mx, export]
---

# DNS
Use DNS to browse hosted zones, add records and delete records. The zone list pages through the account rather than stopping at the first batch; unused zones are labelled for review.

## Add and delete records
Choose a zone and Add Record, then enter its type, name and value. The form sends no TTL, so BinaryLane's default applies: its API reference gives 3600 seconds as the default and only supported value. There is no TTL input or existing-record editor. MX records ask for a priority, SRV records for a priority, weight and port, and CAA records for flags and a tag, because those record types use them; the palette adds A, AAAA, CNAME, MX (with a priority), NS and TXT records, but not SRV or CAA. In the record list, an MX, SRV or CAA row shows those values in blue above its data. These are limits of BLDesk's current controls, not a claim that the DNS API cannot edit records.

The [palette](help:palette#dns) can prepare a DNS record, but still requires review before writing.

## Refresh nameserver information
After changing a domain's nameservers, you may need to use Flush DNS Cache to refresh BinaryLane's cached domain records.

While a refresh is pending, its button shows a spinner and is disabled, including if you leave DNS and reopen it. The button re-enables when the request finishes; BLDesk's short repeat-request cooldown still applies. A refused request shows its reason rather than a success notification. Refresh attempts are not held offline to run on reconnect. Connection failures are reported, and the request is not retried automatically. Another client can still submit a refresh, so BinaryLane may refuse an overlapping request with HTTP 429.

## Worked example
For an example zone example.com with three loaded records, the irreversible dialog is titled “Remove DNS hosting” and says:

“Deletes the DNS zone for example.com and all 3 records in it.”

Your dialog uses the actual domain and record count. If the zone file is available, use “Copy the zone file first” and save that copy before proceeding. Type the domain only if you intend to remove all hosted records. Without a zone file available, export your records independently before removing hosting.

For deleting one record, use its record action instead. Check History and authoritative DNS afterwards. Changing records in BLDesk does not update your registrar's nameserver delegation automatically.
