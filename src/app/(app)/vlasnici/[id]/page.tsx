import { requireActor } from "@/server/actor";
import { getParty, partyDisplayName } from "@/server/services/ownership";
import { ownerBalance, ownerAdvance } from "@/server/services/payments";
import { formatDate } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { PageHeader, Card, Table, Td, Stat, BtnLink } from "@/components/ui";

export default async function PartyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const party = await getParty(actor, id);
  const [balance, advance] = await Promise.all([ownerBalance(actor, id), ownerAdvance(actor, id)]);
  return (
    <div>
      <PageHeader
        title={partyDisplayName(party)}
        subtitle={party.kind === "PERSON" ? "Fizičko lice" : "Pravno lice"}
        actions={<BtnLink href={`/api/dokumenti/kartica/${party.id}`} variant="secondary">Kartica vlasnika (PDF)</BtnLink>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Saldo (duguje)" value={formatMoney(balance.balance)} tone={Number(balance.balance) > 0 ? "warn" : "ok"} />
        <Stat label="Zaduženo" value={formatMoney(balance.charged)} tone="neutral" />
        <Stat label="Plaćeno" value={formatMoney(balance.paid)} tone="ok" />
        <Stat label="Avans" value={formatMoney(advance)} tone="neutral" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Kontakt">
          <dl className="space-y-1 text-sm">
            <div><dt className="inline font-medium">E-mail: </dt><dd className="inline">{party.email ?? "—"}</dd></div>
            <div><dt className="inline font-medium">Telefon: </dt><dd className="inline">{party.phone ?? "—"}</dd></div>
            <div><dt className="inline font-medium">Adresa: </dt><dd className="inline">{party.address ?? "—"}</dd></div>
            <div><dt className="inline font-medium">Adresa za prepisku: </dt><dd className="inline">{party.correspondenceAddress ?? party.address ?? "—"}</dd></div>
          </dl>
        </Card>
        <Card title="Vlasnički udjeli (istorija se čuva)">
          <Table headers={["Jedinica", "Udio %", "Od", "Do"]} empty={party.ownershipStakes.length === 0}>
            {party.ownershipStakes.map((s) => (
              <tr key={s.id} className={s.validTo ? "text-slate-400" : ""}>
                <Td>{s.unit.building.name} / {s.unit.label}</Td>
                <Td right>{s.sharePercent.toString()}</Td>
                <Td>{formatDate(s.validFrom)}</Td>
                <Td>{s.validTo ? formatDate(s.validTo) : "aktivno"}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Korištenje jedinica">
          <Table headers={["Jedinica", "Vrsta", "Od", "Do"]} empty={party.occupancies.length === 0}>
            {party.occupancies.map((o) => (
              <tr key={o.id}>
                <Td>{o.unit.label}</Td>
                <Td>{o.type === "OWNER_OCCUPANT" ? "Vlasnik stanuje" : o.type === "TENANT" ? "Zakupac" : "Korisnik"}</Td>
                <Td>{formatDate(o.validFrom)}</Td>
                <Td>{o.validTo ? formatDate(o.validTo) : "aktivno"}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Punomoći">
          <div className="text-sm">
            <p className="font-medium">Date punomoći:</p>
            <ul className="mb-2 list-inside list-disc text-slate-600">
              {party.proxiesGiven.length === 0 && <li className="list-none text-slate-400">Nema</li>}
              {party.proxiesGiven.map((p) => (
                <li key={p.id}>{partyDisplayName(p.holder)} — {p.revokedAt ? "OPOZVANA" : "aktivna"} od {formatDate(p.validFrom)}</li>
              ))}
            </ul>
            <p className="font-medium">Primljene punomoći:</p>
            <ul className="list-inside list-disc text-slate-600">
              {party.proxiesHeld.length === 0 && <li className="list-none text-slate-400">Nema</li>}
              {party.proxiesHeld.map((p) => (
                <li key={p.id}>za {partyDisplayName(p.grantor)} — {p.revokedAt ? "OPOZVANA" : "aktivna"}</li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}
