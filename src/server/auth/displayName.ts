// Prikazno ime prijavljenog korisnika. Izdvojeno iz getAuthContext() (session.ts) da ga koristi i MCP
// alat `whoami` bez uvlačenja cookie/sesijskog koda u MCP rutu.
import { prisma } from "@/lib/prisma";

type PartyNameFields = { kind: string; firstName: string | null; lastName: string | null; orgName: string | null };

/** Ime Party-ja (osoba: ime i prezime; organizacija: naziv), a bez Party-ja e-pošta. */
export function displayNameOf(party: PartyNameFields | null | undefined, email: string): string {
  if (!party) return email;
  return party.kind === "PERSON" ? `${party.firstName ?? ""} ${party.lastName ?? ""}`.trim() : party.orgName ?? email;
}

/** Prikazno ime korisnika bez aktivnog ZEV-a u kontekstu: najstariji Party koji ovaj nalog ima bilo gdje
 *  (isto pravilo kao u getAuthContext kad nema Party-ja u aktivnom ZEV-u). Bez Party-ja vraća e-poštu, a uz
 *  `withEmail: false` prazan tekst — za izlaze koji e-poštu ne smiju da otkriju (MCP `whoami`). */
export async function displayNameFor(userId: string, opts: { withEmail?: boolean } = {}): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      parties: {
        select: { kind: true, firstName: true, lastName: true, orgName: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
  if (!user) return "";
  const party = user.parties[0];
  if (opts.withEmail === false && !party) return "";
  return displayNameOf(party, opts.withEmail === false ? "" : user.email);
}
