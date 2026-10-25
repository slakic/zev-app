// Zbir vlasničkih udjela po jedinici (F8.4, K-01): jedna čista funkcija za chip „Zbir jedinice” — koriste je tab
// „Vlasništvo” (tabela aktivnih udjela), detalj vlasnika i registar posebnih dijelova. Tolerancija 0,0001 je ista kao u
// `unitOwnershipWarnings` (ownership.ts), pa chip i upozorenja nikad ne kažu različito.
import { Decimal, dec, formatMoney, type DecimalValue } from "@/lib/money";
import { t, tf } from "@/lib/i18n";

export const SHARE_SUM_TOLERANCE = "0.0001";

export type ShareSumKind = "OK" | "OVER" | "UNDER" | "NONE";

/** `stakeCount` = broj AKTIVNIH udjela jedinice; bez njih je jedinica „bez vlasnika” bez obzira na zbir. */
export function classifyShareSum(sum: DecimalValue, stakeCount: number): ShareSumKind {
  if (stakeCount <= 0) return "NONE";
  const s = dec(sum);
  if (s.greaterThan(dec(100).plus(SHARE_SUM_TOLERANCE))) return "OVER";
  if (s.lessThan(dec(100).minus(SHARE_SUM_TOLERANCE))) return "UNDER";
  return "OK";
}

export type ShareSumChip = {
  kind: ShareSumKind;
  ok: boolean;
  /** Ključ u `statusTone`: neutralan kad je 100 %, amber inače. */
  status: "OWNER_SUM_OK" | "OWNER_SUM_WARN";
  label: string;
};

/** „100 %” · „Upisano 50,00 %” · „Zbir 150,00 %” · „Bez vlasnika” (decimalni zarez). */
export function shareSumChip(sum: DecimalValue, stakeCount: number): ShareSumChip {
  const kind = classifyShareSum(sum, stakeCount);
  const shown = formatMoney(new Decimal(sum).toString(), "").trim();
  const label =
    kind === "OK" ? "100 %"
      : kind === "OVER" ? tf("register.sum.over", { sum: shown })
        : kind === "UNDER" ? tf("register.sum.under", { sum: shown })
          : t("register.sum.none");
  return { kind, ok: kind === "OK", status: kind === "OK" ? "OWNER_SUM_OK" : "OWNER_SUM_WARN", label };
}

/** Zbir udjela (decimalni string) za listu udjela jedne jedinice. */
export function sumShares(shares: DecimalValue[]): Decimal {
  return shares.reduce<Decimal>((a, s) => a.plus(dec(s)), dec(0));
}
