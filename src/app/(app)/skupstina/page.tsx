import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireActor, isManagement } from "@/server/actor";
import { listMeetings, createMeeting, listVotingRules, createVotingRule } from "@/server/services/meetings";
import { parseMoneyInput } from "@/lib/money";
import { formatDateTime, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn } from "@/components/ui";

async function addMeetingAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  const body = (formData.get("body") as string) || "ASSEMBLY";
  await createMeeting(actor, {
    title: String(formData.get("title")),
    type: formData.get("type") as never,
    body: body as never,
    location: (formData.get("location") as string) || null,
    scheduledAt: formData.get("scheduledAt") ? new Date(String(formData.get("scheduledAt"))) : null,
    eVoteOpensAt: formData.get("eVoteOpensAt") ? new Date(String(formData.get("eVoteOpensAt"))) : null,
    eVoteClosesAt: formData.get("eVoteClosesAt") ? new Date(String(formData.get("eVoteClosesAt"))) : null,
  });
  revalidatePath("/skupstina");
}

async function addRuleAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT");
  await createVotingRule(actor, {
    name: String(formData.get("name")),
    quorumType: formData.get("quorumType") as never,
    quorumPercent: parseMoneyInput(formData.get("quorumPercent") as string | null),
    majorityType: formData.get("majorityType") as never,
    majorityPercent: parseMoneyInput(formData.get("majorityPercent") as string | null),
    weightMethod: formData.get("weightMethod") as never,
  });
  revalidatePath("/skupstina");
}

export default async function AssemblyPage({ searchParams }: { searchParams: Promise<{ body?: string }> }) {
  const actor = await requireActor();
  const management = isManagement(actor);
  const { body: bodyParam } = await searchParams;
  const activeBody = bodyParam === "BOARD" ? "BOARD" : "ASSEMBLY";
  const [meetings, rules] = await Promise.all([listMeetings(actor, activeBody), listVotingRules(actor)]);
  return (
    <div>
      <PageHeader
        title={activeBody === "BOARD" ? "Upravni odbor" : "Skupština i odluke"}
        subtitle={
          activeBody === "BOARD"
            ? "Sjednice upravnog odbora — prijedlozi i izjašnjavanje članova odbora"
            : "Sjednice skupštine, prijedlozi, elektronsko izjašnjavanje i odluke"
        }
      />
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <Link
          href="/skupstina?body=ASSEMBLY"
          className={`border-b-2 px-3 py-2 text-sm font-medium ${activeBody === "ASSEMBLY" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          Skupština
        </Link>
        <Link
          href="/skupstina?body=BOARD"
          className={`border-b-2 px-3 py-2 text-sm font-medium ${activeBody === "BOARD" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          Upravni odbor
        </Link>
      </div>
      <Card title={activeBody === "BOARD" ? "Sjednice upravnog odbora" : "Sjednice skupštine"}>
        <Table headers={["Sjednica", "Vrsta", "Termin", "Status", "Tačke", "Prijedlozi"]} empty={meetings.length === 0}>
          {meetings.map((m) => (
            <tr key={m.id}>
              <Td><Link href={`/skupstina/${m.id}`} className="text-blue-700 hover:underline">{m.title}</Link></Td>
              <Td>{tEnum("meetingType", m.type)}</Td>
              <Td>{formatDateTime(m.scheduledAt)}</Td>
              <Td><StatusBadge status={m.status} label={tEnum("meetingStatus", m.status)} /></Td>
              <Td right>{m._count.agendaItems}</Td>
              <Td right>{m._count.proposals}</Td>
            </tr>
          ))}
        </Table>
        {actor.roles.includes("PRESIDENT") && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-blue-700">+ Nova sjednica</summary>
            <form action={addMeetingAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 lg:grid-cols-3">
              <Field label="Naziv">
                <input
                  name="title"
                  required
                  className={inputCls}
                  placeholder={activeBody === "BOARD" ? "Sjednica upravnog odbora br. 1" : "Redovna godišnja sjednica 2026."}
                />
              </Field>
              <Field label="Organ">
                <select name="body" defaultValue={activeBody} className={inputCls}>
                  <option value="ASSEMBLY">Skupština</option>
                  <option value="BOARD">Upravni odbor</option>
                </select>
              </Field>
              <Field label="Vrsta">
                <select name="type" className={inputCls}>
                  <option value="REGULAR">Redovna</option>
                  <option value="EXTRAORDINARY">Vanredna</option>
                  <option value="CONSTITUTIVE">Konstitutivna</option>
                  <option value="WRITTEN">Pismeno izjašnjavanje</option>
                </select>
              </Field>
              <Field label="Mjesto"><input name="location" className={inputCls} /></Field>
              <Field label="Datum i vrijeme"><input name="scheduledAt" type="datetime-local" className={inputCls} /></Field>
              <Field label="E-glasanje od"><input name="eVoteOpensAt" type="datetime-local" className={inputCls} /></Field>
              <Field label="E-glasanje do"><input name="eVoteClosesAt" type="datetime-local" className={inputCls} /></Field>
              <div className="flex items-end"><SubmitBtn>Kreiraj sjednicu</SubmitBtn></div>
            </form>
          </details>
        )}
      </Card>

      {management && (
        <div className="mt-4">
          <Card title="Pravila glasanja (konfigurabilna — snimak se čuva uz svaki prijedlog)">
            <Table headers={["Naziv", "Kvorum", "Većina", "Težina glasa"]} empty={rules.length === 0}>
              {rules.map((r) => (
                <tr key={r.id}>
                  <Td>{r.name}</Td>
                  <Td>{tEnum("quorum", r.quorumType)}{r.quorumPercent ? ` (${r.quorumPercent}%)` : ""}</Td>
                  <Td>{tEnum("majority", r.majorityType)}{r.majorityPercent ? ` (${r.majorityPercent}%)` : ""}</Td>
                  <Td>{tEnum("weight", r.weightMethod)}</Td>
                </tr>
              ))}
            </Table>
            {actor.roles.includes("PRESIDENT") && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-blue-700">+ Novo pravilo</summary>
                <form action={addRuleAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 lg:grid-cols-3">
                  <Field label="Naziv"><input name="name" required className={inputCls} placeholder="Redovno upravljanje" /></Field>
                  <Field label="Tip kvoruma">
                    <select name="quorumType" className={inputCls}>
                      <option value="PERCENT_OF_TOTAL_WEIGHT">% ukupne težine</option>
                      <option value="PERCENT_OF_OWNER_COUNT">% broja vlasnika</option>
                      <option value="NONE">Bez kvoruma</option>
                    </select>
                  </Field>
                  <Field label="Kvorum %"><input name="quorumPercent" className={inputCls} placeholder="50" /></Field>
                  <Field label="Tip većine">
                    <select name="majorityType" className={inputCls}>
                      <option value="SIMPLE_OF_VOTES_CAST">Prosta većina glasalih</option>
                      <option value="PERCENT_OF_VOTES_CAST">% glasalih</option>
                      <option value="PERCENT_OF_ELIGIBLE_WEIGHT">% ukupne baze</option>
                    </select>
                  </Field>
                  <Field label="Većina %"><input name="majorityPercent" className={inputCls} placeholder="50" /></Field>
                  <Field label="Težina glasa">
                    <select name="weightMethod" className={inputCls}>
                      <option value="OWNERSHIP_SHARE">Po vlasničkom udjelu</option>
                      <option value="PER_OWNER">Po vlasniku (1 glas)</option>
                      <option value="USABLE_AREA">Po površini</option>
                    </select>
                  </Field>
                  <div className="flex items-end"><SubmitBtn>Sačuvaj pravilo</SubmitBtn></div>
                </form>
              </details>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Napomena: zakonski kvorum i većine po tipu odluke potvrđuje pravnik — vidjeti LEGAL_AND_FINANCIAL_ASSUMPTIONS.md.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
