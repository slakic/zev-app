// "Za Vas sada" za predsjednika (F6.5, odluka D1 A): rangirana lista onoga što traži njegovu radnju. Čista funkcija
// kao `ownerTasks`: stranica daje podatke koje ionako učitava, izlaz je determinističan (rang, pa datum, pa ključ),
// pa se početna "ne mijenja sama". Neraspoređene uplate i nacrti serija faktura nisu stavke predsjednika (F5).
import { calendarDaysBetween } from "@/lib/paymentInstructions";
import { isFewForm, isOneForm } from "@/lib/plural";
import { formatDate, t, tEnum, tf } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";

export const EXPIRING_VOTE_DAYS = 3;
export const MEETING_SOON_DAYS = 7;
export const PLAN_ITEM_LOOKBACK_DAYS = 90;

export type PresidentTasksInput = {
  now: Date;
  /** `Zev.unitRegisterStatus`; stavka postoji dok registar nije utvrđen. */
  registerStatus: string | null;
  /** Prijedlozi u statusu "Glasanje otvoreno" (najviše 5). `quorumNeeded` je tekst praga ("3") kad kvorum nije postignut. */
  votings: {
    proposalId: string; code: string; title: string; meetingId: string; meetingTitle: string;
    closesAt: Date | null; voted: number; voters: number; quorumReached: boolean; quorumNeeded: string | null;
  }[];
  /** Sjednice u narednih 7 dana; `nextStepLabel` i `warnings` dolaze iz `meetingNextStep`. */
  meetings: { id: string; title: string; scheduledAt: Date; nextStepLabel: string; warnings: string[] }[];
  /** Samo uz F6.4: prijave od "Odobreno" naviše čiji vezani prijedlog nije usvojen. */
  issuesBeforeDecision: { id: string; title: string; status: string; proposalCode: string }[];
  /** Pregledi/preventivno održavanje kojima je datum prošao u posljednjih 90 dana, bez vezane prijave. */
  planItemsPassed: { id: string; planId: string; name: string; scheduledDate: Date }[];
  /** Prijave u statusu "Prijavljeno" (čekaju trijažu). */
  reportedIssues: number;
  /** F8.5: jedinice sa zbirom aktivnih udjela različitim od 100 % (`unitOwnershipWarnings`); `sum` je decimalni string. */
  unitShareWarnings?: { unitId: string; label: string; kind: "OVER" | "UNDER" | "NONE"; sum: string }[];
};

/** Najviše toliko jedinica se navodi imenom u rečenici; ostale su „i još N”. */
export const SHARE_WARNING_NAMED = 3;

export type PresidentTask = {
  key: string;
  rank: number;
  chip: { status: string; label: string };
  sentence: string;
  meta?: string;
  href: string;
  actionLabel: string;
  /** Samo najhitnija stavka ima glavno dugme. */
  primary: boolean;
};

export type PresidentTasksResult = { tasks: PresidentTask[]; allClear: boolean };

const time = (d: Date | null) => d?.getTime() ?? Number.POSITIVE_INFINITY;

export function presidentTasks(input: PresidentTasksInput): PresidentTasksResult {
  const { now } = input;
  const groups: PresidentTask[][] = [[], [], [], [], [], [], []];
  const add = (rank: number, task: Omit<PresidentTask, "rank" | "primary">) => groups[rank - 1].push({ ...task, rank, primary: false });

  // 1. Registar nije utvrđen (FR-Q4) — postojeća kartica postaje prva stavka.
  if (input.registerStatus && input.registerStatus !== "ESTABLISHED") {
    add(1, {
      key: "register",
      chip: { status: `REGISTER_${input.registerStatus}`, label: tEnum("unitRegisterStatus", input.registerStatus) },
      sentence: t("register.home.todo"),
      href: "/zgrade?tab=posebni",
      actionLabel: t("register.home.link"),
    });
  }

  // 1b. Zbir udjela iznad 100 % (F8.5) — odmah iza registra, jer blokira otvaranje glasanja (K-01b). Isti rang kao registar.
  // Dok je registar u nacrtu tab „Vlasništvo” je zaključan, pa stavka tada ne postoji (prva je stavka registra).
  const shareWarnings = input.registerStatus === "DRAFT" ? [] : [...(input.unitShareWarnings ?? [])]
    .sort((a, b) => a.label.localeCompare(b.label, "sr-Latn") || a.unitId.localeCompare(b.unitId));
  const shareList = (ws: typeof shareWarnings) => {
    const named = ws.slice(0, SHARE_WARNING_NAMED).map((w) =>
      w.kind === "NONE" ? tf("presidentTasks.shareSum.itemNone", { jedinica: w.label })
        : tf("presidentTasks.shareSum.item", { jedinica: w.label, zbir: formatMoney(w.sum, "").trim() }));
    const rest = ws.length - named.length;
    return rest > 0 ? `${named.join(", ")} ${tf("presidentTasks.shareSum.more", { broj: rest })}` : named.join(", ");
  };
  const shareSentence = (kind: "over" | "under", ws: typeof shareWarnings) => {
    const n = ws.length;
    return tf(`presidentTasks.shareSum.${kind}.${isOneForm(n) ? "one" : isFewForm(n) ? "few" : "many"}`, { broj: n, lista: shareList(ws) });
  };
  const over = shareWarnings.filter((w) => w.kind === "OVER");
  if (over.length > 0) {
    add(1, {
      key: "share-sum-over",
      chip: { status: "OWNER_SUM_WARN", label: t("presidentTasks.shareSum.badge") },
      sentence: shareSentence("over", over),
      meta: t("presidentTasks.shareSum.overMeta"),
      href: "/vlasnici?tab=vlasnistvo",
      actionLabel: t("presidentTasks.shareSum.action"),
    });
  }

  // 2./3. Glasanje: rok prošao (a još je otvoreno), pa ističe za ≤ 3 dana bez kvoruma.
  const byDeadline = (a: PresidentTasksInput["votings"][number], b: PresidentTasksInput["votings"][number]) =>
    time(a.closesAt) - time(b.closesAt) || a.code.localeCompare(b.code) || a.proposalId.localeCompare(b.proposalId);
  for (const v of [...input.votings].sort(byDeadline)) {
    if (!v.closesAt) continue;
    if (v.closesAt.getTime() < now.getTime()) {
      add(2, {
        key: `vote-overdue:${v.proposalId}`,
        chip: { status: "UNPAID", label: t("presidentTasks.votingOverdue.badge") },
        sentence: tf("presidentTasks.votingOverdue.text", { sifra: v.code, naslov: v.title, datum: formatDate(v.closesAt), sjednica: v.meetingTitle }),
        meta: tf("presidentTasks.votingProgress", { glasalo: v.voted, ukupno: v.voters }),
        href: `/skupstina/${v.meetingId}`,
        actionLabel: t("presidentTasks.openMeeting"),
      });
    } else if (!v.quorumReached && calendarDaysBetween(now, v.closesAt) <= EXPIRING_VOTE_DAYS) {
      add(3, {
        key: `vote-expiring:${v.proposalId}`,
        chip: { status: "PENDING", label: t("presidentTasks.votingExpiring.badge") },
        sentence: tf("presidentTasks.votingExpiring.text", { sifra: v.code, naslov: v.title, datum: formatDate(v.closesAt) }),
        meta: v.quorumNeeded
          ? tf("presidentTasks.votingExpiring.meta", { glasalo: v.voted, ukupno: v.voters, potrebno: v.quorumNeeded })
          : tf("presidentTasks.votingProgress", { glasalo: v.voted, ukupno: v.voters }),
        href: `/skupstina/prijedlog/${v.proposalId}`,
        actionLabel: t("presidentTasks.viewProposal"),
      });
    }
  }

  // 4. Sjednica u narednih 7 dana — sljedeći korak iz istog modela kao panel na sjednici.
  for (const m of [...input.meetings].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime() || a.id.localeCompare(b.id))) {
    const days = calendarDaysBetween(now, m.scheduledAt);
    if (days < 0 || days > MEETING_SOON_DAYS) continue;
    const kada = days === 0 ? t("presidentTasks.meeting.today") : days === 1 ? t("presidentTasks.meeting.tomorrow")
      : tf(isOneForm(days) ? "presidentTasks.meeting.inDaysOne" : "presidentTasks.meeting.inDaysOther", { dana: days });
    add(4, {
      key: `meeting:${m.id}`,
      chip: { status: "SCHEDULED", label: t("presidentTasks.meeting.badge") },
      sentence: tf("presidentTasks.meeting.text", { naslov: m.title, kada, korak: m.nextStepLabel }),
      meta: m.warnings.length > 0 ? m.warnings.join(" · ") : undefined,
      href: `/skupstina/${m.id}`,
      actionLabel: t("presidentTasks.openMeeting"),
    });
  }

  // 5. Izvršenje prije odluke (F6.4).
  for (const i of [...input.issuesBeforeDecision].sort((a, b) => a.title.localeCompare(b.title, "sr-Latn") || a.id.localeCompare(b.id))) {
    add(5, {
      key: `issue-before:${i.id}`,
      chip: { status: "AUTHORIZATION_REQUIRED", label: t("presidentTasks.beforeDecision.badge") },
      sentence: tf("presidentTasks.beforeDecision.text", { naslov: i.title, status: tEnum("issueStatus", i.status), sifra: i.proposalCode }),
      href: `/odrzavanje/${i.id}`,
      actionLabel: t("presidentTasks.viewIssue"),
    });
  }

  // 6. Pregled / preventivno održavanje kojem je prošao datum, a nema vezane prijave.
  for (const p of [...input.planItemsPassed].sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime() || a.id.localeCompare(b.id))) {
    const ago = calendarDaysBetween(p.scheduledDate, now);
    if (ago <= 0 || ago > PLAN_ITEM_LOOKBACK_DAYS) continue;
    add(6, {
      key: `plan-item:${p.id}`,
      chip: { status: "PENDING", label: t("presidentTasks.planItem.badge") },
      sentence: tf("presidentTasks.planItem.text", {
        naziv: p.name, datum: formatDate(p.scheduledDate),
        kada: tf(isOneForm(ago) ? "pay.daysAgo.one" : "pay.daysAgo.other", { dana: ago }),
      }),
      href: `/planovi/${p.planId}`,
      actionLabel: t("presidentTasks.viewPlan"),
    });
  }

  // 7a. Zbir udjela ispod 100 % ili jedinica bez vlasnika (F8.5) — ne blokira glasanje, pa niži rang.
  const under = shareWarnings.filter((w) => w.kind !== "OVER");
  if (under.length > 0) {
    add(7, {
      key: "share-sum-under",
      chip: { status: "OWNER_SUM_WARN", label: t("presidentTasks.shareSum.badge") },
      sentence: shareSentence("under", under),
      href: "/vlasnici?tab=vlasnistvo",
      actionLabel: t("presidentTasks.shareSum.action"),
    });
  }

  // 7. Nove prijave održavanja čekaju trijažu — jedna zbirna stavka.
  if (input.reportedIssues > 0) {
    const n = input.reportedIssues;
    add(7, {
      key: "issues-reported",
      chip: { status: "REPORTED", label: t("presidentTasks.reported.badge") },
      sentence: tf(isOneForm(n) ? "presidentTasks.reported.one" : isFewForm(n) ? "presidentTasks.reported.few" : "presidentTasks.reported.many", { broj: n }),
      href: "/odrzavanje",
      actionLabel: t("presidentTasks.reported.action"),
    });
  }

  const tasks = groups.flat();
  if (tasks.length > 0) tasks[0].primary = true;
  return { tasks, allClear: tasks.length === 0 };
}
