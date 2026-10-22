// Pure helper (no server imports) so the /admin settings card can preview the exact name the
// notification service will send — Plans/email-sender-name-and-test-email-plan.md, R1.

/** "ZEV upravnik – Kneza Miloša 12": the base name, plus the ZEV's short (else legal) name when
 *  the message belongs to one and the setting asks for it. */
export function buildFromName(base: string, zev: { shortName: string | null; legalName: string } | null): string {
  if (!zev) return base;
  const label = zev.shortName?.trim() || (zev.legalName.length > 40 ? `${zev.legalName.slice(0, 39).trim()}…` : zev.legalName);
  return label ? `${base} – ${label}` : base;
}
