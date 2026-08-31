import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import {
  listOfficeHolders, listOfficeHistory, addBoardMember, endBoardMembership, setOfficeTerm,
  listParties, partyDisplayName,
} from "@/server/services/ownership";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, Field, inputCls, SubmitBtn, Flash } from "@/components/ui";

async function setOfficerAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  try {
    await setOfficeTerm(actor, {
      role: formData.get("role") as "PRESIDENT" | "ACCOUNTANT",
      partyId: String(formData.get("partyId")),
      validFrom: new Date(String(formData.get("validFrom"))),
      decisionRef: (formData.get("decisionRef") as string) || null,
    });
  } catch (e) {
    redirect(`/organi?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/organi");
}

async function addBoardMemberAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  try {
    await addBoardMember(actor, {
      partyId: String(formData.get("partyId")),
      validFrom: new Date(String(formData.get("validFrom"))),
      decisionRef: (formData.get("decisionRef") as string) || null,
    });
  } catch (e) {
    redirect(`/organi?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/organi");
}

async function endBoardMemberAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  try {
    await endBoardMembership(
      actor,
      String(formData.get("termId")),
      new Date(String(formData.get("validTo") || new Date().toISOString())),
      (formData.get("reason") as string) || null
    );
  } catch (e) {
    redirect(`/organi?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/organi");
}

export default async function OrganiPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const actor = await requireActor();
  const isPresident = actor.roles.includes("PRESIDENT");
  const { err } = await searchParams;

  const [holders, history, settings] = await Promise.all([
    listOfficeHolders(actor),
    listOfficeHistory(actor),
    prisma.setting.findMany({ where: { key: { in: ["board.size", "board.termYears", "board.presidentIsBoardPresident"] } } }),
  ]);
  const parties = isPresident ? await listParties(actor) : [];
  const settingsMap = new Map(settings.map((s) => [s.key, String(s.value)]));
  const boardSize = settingsMap.get("board.size") ?? "3";
  const termYears = settingsMap.get("board.termYears") ?? "4";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organi ZEV"
        subtitle="Predsjednik, računovođa i upravni odbor — trenutni sastav i istorija mandata"
      />
      <Flash err={err} />

      <Card>
        <p className="text-sm text-slate-600">
          Prema Zakonu o održavanju zgrada Republike Srpske organi ZEV su <b>skupština</b> (svi vlasnici) i{" "}
          <b>upravni odbor</b> (kolegijalno tijelo koje skupština bira). Tačan broj članova upravnog odbora,
          trajanje mandata i pretpostavka da je predsjednik ZEV ujedno i predsjednik upravnog odbora su{" "}
          <b>podesivi</b> (vidi <i>Podešavanja</i>) i flagovani su za pravnu potvrdu — vidi{" "}
          <code>LEGAL_AND_FINANCIAL_ASSUMPTIONS.md §Organi ZEV</code>. Preporučeni broj članova upravnog odbora
          trenutno je <b>{boardSize}</b>, trajanje mandata <b>{termYears}</b> godina.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card title="Predsjednik ZEV">
          {holders.president ? (
            <div className="text-sm">
              <div className="text-lg font-semibold text-slate-900">{partyDisplayName(holders.president.party)}</div>
              <div className="mt-1 text-slate-500">Mandat od {formatDate(holders.president.validFrom)}</div>
              {holders.president.decisionRef && <div className="text-xs text-slate-400">Osnov: {holders.president.decisionRef}</div>}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Nije evidentiran predsjednik.</p>
          )}
        </Card>
        <Card title="Računovođa">
          {holders.accountant ? (
            <div className="text-sm">
              <div className="text-lg font-semibold text-slate-900">{partyDisplayName(holders.accountant.party)}</div>
              <div className="mt-1 text-slate-500">Angažman od {formatDate(holders.accountant.validFrom)}</div>
              {holders.accountant.decisionRef && <div className="text-xs text-slate-400">Osnov: {holders.accountant.decisionRef}</div>}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Nije evidentiran računovođa.</p>
          )}
        </Card>
      </div>

      {isPresident && (
        <Card title="Postavi predsjednika / računovođu">
          <form action={setOfficerAction} className="grid grid-cols-1 gap-3 md:grid-cols-5 md:items-end">
            <Field label="Funkcija">
              <select name="role" className={inputCls}>
                <option value="PRESIDENT">Predsjednik ZEV</option>
                <option value="ACCOUNTANT">Računovođa</option>
              </select>
            </Field>
            <Field label="Lice">
              <select name="partyId" required className={inputCls}>
                {parties.map((p) => <option key={p.id} value={p.id}>{partyDisplayName(p)}</option>)}
              </select>
            </Field>
            <Field label="Mandat od"><input name="validFrom" type="date" required className={inputCls} /></Field>
            <Field label="Osnov (odluka/ugovor)"><input name="decisionRef" className={inputCls} placeholder="Odluka skupštine ..." /></Field>
            <SubmitBtn>Postavi</SubmitBtn>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            Postavljanje nove osobe automatski okončava tekući mandat prethodnog nosioca te funkcije na izabrani datum.
          </p>
        </Card>
      )}

      <Card title={`Upravni odbor (${holders.boardMembers.length} ${holders.boardMembers.length === 1 ? "član" : "člana"})`}>
        <Table headers={["Član", "Mandat od", "Osnov", isPresident ? "Akcija" : ""]} empty={holders.boardMembers.length === 0}>
          {holders.boardMembers.map((m) => (
            <tr key={m.id}>
              <Td>{partyDisplayName(m.party)}</Td>
              <Td>{formatDate(m.validFrom)}</Td>
              <Td className="text-xs text-slate-500">{m.decisionRef ?? "—"}</Td>
              <Td>
                {isPresident && (
                  <form action={endBoardMemberAction} className="flex items-center gap-1">
                    <input type="hidden" name="termId" value={m.id} />
                    <input type="date" name="validTo" className="rounded border border-slate-300 px-1 py-0.5 text-xs" />
                    <SubmitBtn variant="danger">Okončaj mandat</SubmitBtn>
                  </form>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      {isPresident && (
        <Card title="Dodaj člana upravnog odbora">
          <form action={addBoardMemberAction} className="grid grid-cols-1 gap-3 md:grid-cols-4 md:items-end">
            <Field label="Lice">
              <select name="partyId" required className={inputCls}>
                {parties.map((p) => <option key={p.id} value={p.id}>{partyDisplayName(p)}</option>)}
              </select>
            </Field>
            <Field label="Mandat od"><input name="validFrom" type="date" required className={inputCls} /></Field>
            <Field label="Osnov (odluka skupštine)"><input name="decisionRef" className={inputCls} placeholder="Odluka skupštine ..." /></Field>
            <SubmitBtn>Dodaj</SubmitBtn>
          </form>
        </Card>
      )}

      <Card title="Istorija mandata">
        <Table headers={["Funkcija", "Lice", "Od", "Do", "Osnov"]} empty={history.length === 0}>
          {history.map((h) => (
            <tr key={h.id}>
              <Td>{h.role === "PRESIDENT" ? "Predsjednik ZEV" : h.role === "ACCOUNTANT" ? "Računovođa" : "Član upravnog odbora"}</Td>
              <Td>{partyDisplayName(h.party)}</Td>
              <Td className="whitespace-nowrap text-xs">{formatDate(h.validFrom)}</Td>
              <Td className="whitespace-nowrap text-xs">{h.validTo ? formatDate(h.validTo) : <span className="text-emerald-600">aktivno</span>}</Td>
              <Td className="text-xs text-slate-500">{h.decisionRef ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
