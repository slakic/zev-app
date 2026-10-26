// Upozorenja registra o udjelima i glasackoj osnovi (K-01a, K-03b) kao nizovi teksta za PreconditionList —
// jedno mjesto za tab "Vlasnistvo" i registar posebnih dijelova. Ne blokiraju nista osim sto je u `votingSubject.pre`.
import { tf } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";

type Warning = { label: string; kind: "NONE" | "UNDER" | "OVER"; sum: { toString(): string } };

export function registerWarningTexts(reg: {
  warnings: Warning[];
  subjects: { ownerName: string; representativeSoleName: string | null }[];
  absorbed: { names: string; units: string[] }[];
}): string[] {
  const out: string[] = [];
  for (const w of reg.warnings) {
    const sum = formatMoney(w.sum.toString(), "").trim();
    out.push(
      w.kind === "OVER" ? tf("register.owners.warnOver", { unit: w.label, sum })
        : w.kind === "UNDER" ? tf("register.owners.warnUnder", { unit: w.label, sum })
        : tf("register.owners.warnNone", { unit: w.label }),
    );
  }
  for (const s of reg.subjects) {
    if (s.representativeSoleName) {
      out.push(tf("register.owners.warnRepSole", { community: s.ownerName, rep: s.representativeSoleName }));
    }
  }
  for (const a of reg.absorbed) {
    out.push(tf("register.owners.infoAbsorbed", { community: a.names, units: a.units.join(", ") }));
  }
  return out;
}
