// "Za Vas sada" za računovođu (F5a.2, odluka D1 A): rangirana lista posla koji čeka. Čista funkcija kao `ownerTasks`
// i `presidentTasks`: stranica (preko servisa `accountantHome`) daje brojeve, izlaz je determinističan (rang, pa ključ).
// Svaki broj dolazi iz ISTOG uslova kao filter odredišta (uplate: `paymentWhereForFilter`, troškovi:
// `expensesDueWhere`), pa broj na početnoj uvijek odgovara onome što korisnik vidi poslije klika.
import { formatMoney } from "@/lib/money";
import { t, tf } from "@/lib/i18n";
import { currentPeriod } from "@/lib/batchPeriod";

export const EXPENSE_DUE_DAYS = 7;

export type HomeTask = {
  key: string;
  chip: { status: string; label: string };
  sentence: string;
  meta?: string;
  /** Broj stavki koje čekaju; prikazuje se uz chip. */
  count?: number;
  href: string;
  /** Bez `actionLabel` red je informativan (nema dugmeta). */
  actionLabel?: string;
  /** Samo prva radnja (ne informativni red) ima glavno dugme. */
  primary: boolean;
};

export type AccountantTask = HomeTask & { rank: number };

export type AccountantTasksInput = {
  now: Date;
  /** Svi nacrti serija (najnoviji prvi). */
  draftBatches: { id: string; period: string }[];
  /** Serije sa fakturama čija je posljednja poruka e-poštom „Neuspješno”. */
  failedEmailBatches: { batchId: string; period: string; failed: number }[];
  /** Broj uplata `status=ZA_UPARIVANJE` (isti uslov kao filter). */
  toMatchCount: number;
  /** Uplate `status=AVANS`: broj i ukupan slobodan iznos (Decimal kao string). */
  advance: { count: number; total: string };
  /** SMS prijem; stavke SMS-a postoje samo kad je automatski prijem uključen (R-N16). */
  sms: { active: boolean; pending: number; duplicates: number; unconfirmed: number };
  /** Neplaćeni troškovi sa rokom u narednih 7 dana ili već prošlim (isti uslov kao filter `rok=7`). */
  expensesDue: { count: number; overdue: number };
  /** Predloženi period sljedeće serije (`suggestBatchPeriod`). */
  suggestedPeriod: string;
  /** Postoji bar jedna aktivna stavka naknade (bez nje nema šta da se obračuna). */
  hasActiveChargeItems: boolean;
};

export type AccountantTasksResult = {
  tasks: AccountantTask[];
  /** Nema nijedne stavke koja traži radnju (informativni red avansa se ne računa). */
  allClear: boolean;
  /** Ima radnji, ali nisu sve kategorije aktivne — prikazuje se „Sve ostalo je završeno”. */
  restDone: boolean;
};

const CATEGORIES_WITH_SMS = 8;
const CATEGORIES_WITHOUT_SMS = 5;

export function accountantTasks(input: AccountantTasksInput): AccountantTasksResult {
  const groups: AccountantTask[][] = [[], [], [], [], [], [], [], [], []];
  const add = (rank: number, task: Omit<AccountantTask, "rank" | "primary">) => groups[rank - 1].push({ ...task, rank, primary: false });

  // 1. Nacrt serije čeka izdavanje.
  const drafts = input.draftBatches;
  if (drafts.length === 1) {
    add(1, {
      key: `draft:${drafts[0].id}`,
      chip: { status: "DRAFT", label: t("accountantTasks.draft.badge") },
      sentence: tf("accountantTasks.draft.one", { period: drafts[0].period }),
      href: `/fakture/serija/${drafts[0].id}`,
      actionLabel: t("accountantTasks.draft.view"),
    });
  } else if (drafts.length > 1) {
    add(1, {
      key: "draft:many",
      chip: { status: "DRAFT", label: t("accountantTasks.draft.badge") },
      sentence: t("accountantTasks.draft.many"),
      count: drafts.length,
      href: "/fakture?tab=naknade",
      actionLabel: t("accountantTasks.draft.viewMany"),
    });
  }

  // 2. Neuspjela e-pošta faktura — jedna stavka po seriji (broj = „Neuspješno” na stranici te serije).
  for (const b of [...input.failedEmailBatches].sort((x, y) => y.period.localeCompare(x.period) || x.batchId.localeCompare(y.batchId))) {
    if (b.failed <= 0) continue;
    add(2, {
      key: `email-failed:${b.batchId}`,
      chip: { status: "FAILED", label: t("accountantTasks.emailFailed.badge") },
      sentence: tf("accountantTasks.emailFailed.text", { period: b.period }),
      count: b.failed,
      href: `/fakture/serija/${b.batchId}`,
      actionLabel: t("accountantTasks.emailFailed.action"),
    });
  }

  // 3. Uplate za uparivanje (bez avansa, F5-Q3).
  if (input.toMatchCount > 0) {
    add(3, {
      key: "payments-to-match",
      chip: { status: "UNAPPLIED", label: t("accountantTasks.toMatch.badge") },
      sentence: t("accountantTasks.toMatch.text"),
      count: input.toMatchCount,
      href: "/fakture/uplate?status=ZA_UPARIVANJE",
      actionLabel: t("accountantTasks.toMatch.action"),
    });
  }

  // 4.–6. SMS stavke samo uz uključen automatski prijem.
  if (input.sms.active) {
    if (input.sms.pending > 0) {
      add(4, {
        key: "sms-pending",
        chip: { status: "PENDING", label: t("accountantTasks.smsPending.badge") },
        sentence: t("accountantTasks.smsPending.text"),
        count: input.sms.pending,
        href: "/fakture/uplate/sms",
        actionLabel: t("accountantTasks.smsPending.action"),
      });
    }
    if (input.sms.duplicates > 0) {
      add(5, {
        key: "sms-duplicates",
        chip: { status: "PENDING", label: t("accountantTasks.duplicates.badge") },
        sentence: t("accountantTasks.duplicates.text"),
        count: input.sms.duplicates,
        href: "/fakture/uplate/uskladjivanje",
        actionLabel: t("accountantTasks.reconcile"),
      });
    }
    if (input.sms.unconfirmed > 0) {
      add(6, {
        key: "sms-unconfirmed",
        chip: { status: "PENDING", label: t("accountantTasks.unconfirmed.badge") },
        sentence: t("accountantTasks.unconfirmed.text"),
        count: input.sms.unconfirmed,
        href: "/fakture/uplate/uskladjivanje",
        actionLabel: t("accountantTasks.reconcile"),
      });
    }
  }

  // 7. Troškovi koji dospijevaju u narednih 7 dana (i dospjeli neplaćeni).
  if (input.expensesDue.count > 0) {
    add(7, {
      key: "expenses-due",
      chip: { status: "UNPAID", label: t("accountantTasks.expenses.badge") },
      sentence: tf("accountantTasks.expenses.text", { dana: EXPENSE_DUE_DAYS }),
      meta: input.expensesDue.overdue > 0 ? tf("accountantTasks.expenses.overdue", { broj: input.expensesDue.overdue }) : undefined,
      count: input.expensesDue.count,
      href: `/troskovi?tab=troskovi&rok=${EXPENSE_DUE_DAYS}`,
      actionLabel: t("accountantTasks.expenses.action"),
    });
  }

  // 8. Serija za tekući (ili zaostali) period nije napravljena — samo ako ima šta da se obračuna, a nacrt ne postoji.
  if (
    input.hasActiveChargeItems &&
    input.suggestedPeriod <= currentPeriod(input.now) &&
    !input.draftBatches.some((d) => d.period === input.suggestedPeriod)
  ) {
    add(8, {
      key: `no-batch:${input.suggestedPeriod}`,
      chip: { status: "NONE", label: t("accountantTasks.noBatch.badge") },
      sentence: tf("accountantTasks.noBatch.text", { period: input.suggestedPeriod }),
      href: "/fakture?tab=naknade",
      actionLabel: t("accountantTasks.noBatch.action"),
    });
  }

  const actionable = groups.slice(0, 8).flat();
  if (actionable.length > 0) actionable[0].primary = true;

  // Informativno: avansi (platilac bez otvorenih faktura) — bez dugmeta, ne računa se u „posao”.
  const info: AccountantTask[] = [];
  if (input.advance.count > 0) {
    info.push({
      key: "advances",
      rank: 9,
      chip: { status: "NONE", label: t("accountantTasks.advance.badge") },
      sentence: tf("accountantTasks.advance.text", { iznos: formatMoney(input.advance.total) }),
      count: input.advance.count,
      href: "/fakture/uplate?status=AVANS",
      primary: false,
    });
  }

  const categories = input.sms.active ? CATEGORIES_WITH_SMS : CATEGORIES_WITHOUT_SMS;
  return {
    tasks: [...actionable, ...info],
    allClear: actionable.length === 0,
    restDone: actionable.length > 0 && actionable.length < categories,
  };
}

/** Korisnik sa obje uloge (F5-Q2 (a)): jedna lista. Redoslijed: stavke predsjednika ranga 1–3 (glasanja koja ističu),
 *  zatim računovođine radnje, zatim ostale stavke predsjednika, na kraju informativni redovi. Samo prva radnja
 *  ima glavno dugme. */
export function mergeTasks(
  president: (HomeTask & { rank: number })[],
  accountant: (HomeTask & { rank: number })[],
): HomeTask[] {
  const accAction = accountant.filter((x) => x.actionLabel !== undefined);
  const accInfo = accountant.filter((x) => x.actionLabel === undefined);
  const merged = [
    ...president.filter((x) => x.rank <= 3),
    ...accAction,
    ...president.filter((x) => x.rank > 3),
    ...accInfo,
  ].map((x): HomeTask => ({
    key: x.key, chip: x.chip, sentence: x.sentence, meta: x.meta, count: x.count, href: x.href, actionLabel: x.actionLabel, primary: false,
  }));
  const first = merged.find((x) => x.actionLabel !== undefined);
  if (first) first.primary = true;
  return merged;
}
