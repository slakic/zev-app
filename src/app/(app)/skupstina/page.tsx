import { revalidatePath } from "next/cache";
import { requireActor, isManagement } from "@/server/actor";
import { listMeetings, createMeeting, listVotingRules, createVotingRule } from "@/server/services/meetings";
import { parseMoneyInput } from "@/lib/money";
import { formatDateTime, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, ToggleBtn, RowLink, Tabs, type ColumnSpec } from "@/components/ui";

const votingRuleHeaders: ColumnSpec[] = [
  { label: "Naziv" },
  { label: "Kvorum" },
  { label: "Većina" },
  { label: "Težina glasa" },
];

const meetingHeaders: ColumnSpec[] = [
  { label: "Sjednica", priority: "primary" },
  { label: "Vrsta", priority: "detail" },
  { label: "Termin" },
  { label: "Status" },
  { label: "Tačke", align: "right", priority: "detail" },
  { label: "Prijedlozi", align: "right" },
];

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

export default async function AssemblyPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireActor();
  const management = isManagement(actor);
  const { tab } = await searchParams;
  const activeBody = tab === "BOARD" ? "BOARD" : "ASSEMBLY";
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
      <Tabs
        tabs={[
          { key: "ASSEMBLY", label: "Skupština" },
          { key: "BOARD", label: "Upravni odbor" },
        ]}
        active={activeBody}
        hrefFor={(key) => `/skupstina?tab=${key}`}
      />
      <Card title={activeBody === "BOARD" ? "Sjednice upravnog odbora" : "Sjednice skupštine"}>
        <Table
          id="meetings-table"
          caption={activeBody === "BOARD" ? "Sjednice upravnog odbora" : "Sjednice skupštine"}
          headers={meetingHeaders}
          empty={meetings.length === 0}
        >
          {meetings.map((m) => (
            <tr key={m.id}>
              <Td><RowLink href={`/skupstina/${m.id}`}>{m.title}</RowLink></Td>
              <Td>{tEnum("meetingType", m.type)}</Td>
              <Td>{formatDateTime(m.scheduledAt)}</Td>
              <Td><StatusBadge status={m.status} label={tEnum("meetingStatus", m.status)} /></Td>
              <Td>{m._count.agendaItems}</Td>
              <Td>{m._count.proposals}</Td>
            </tr>
          ))}
        </Table>
        {actor.roles.includes("PRESIDENT") && (
          <details className="group mt-4">
            <ToggleBtn>Nova sjednica</ToggleBtn>
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
          <Card title="Pravila glasanja" hint="Konfigurabilna — snimak pravila se čuva uz svaki prijedlog, pa kasnija izmjena ne utiče na već otvorena glasanja.">
            <Table id="voting-rules-table" caption="Pravila glasanja" headers={votingRuleHeaders} empty={rules.length === 0}>
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
              <details className="group mt-4">
                <ToggleBtn>Novo pravilo</ToggleBtn>
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
            <p className="mt-3 text-[13px] text-slate-500">
              Napomena: zakonski kvorum i većine po tipu odluke potvrđuje pravnik prije produkcijske upotrebe.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
