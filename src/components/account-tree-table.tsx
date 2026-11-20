// Tabela kontnog plana sa hijerarhijom (A-Q6 (b), Plans/kontni-plan-i-knjizenje-plan.md §3.8): obična `Table`,
// prva kolona uvučena po dubini u koracima od 16px (najviše 6 nivoa), zbirna konta `font-semibold`.
// Četiri kolone bez kolone radnji, pa i na telefonu ostaje tabela (horizontalni skrol), a stablo se ne raspada
// u kartice. Koriste je kontni plan ZEV-a i detalj kontnog predloška u adminu.
import { Table, Td, RowLink, StatusBadge, type ColumnSpec } from "@/components/ui";
import { flattenTree } from "@/lib/accountCodes";
import { t, tEnum } from "@/lib/i18n";

const INDENT = ["pl-0", "pl-4", "pl-8", "pl-12", "pl-16", "pl-20"] as const;

export type AccountTreeRow = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  nature: string;
  postable: boolean;
  active?: boolean;
};

const headers: ColumnSpec[] = [
  { label: t("ledger.list.colAccount"), priority: "primary" },
  { label: t("ledger.list.colNature"), priority: "secondary" },
  { label: t("ledger.list.colKind"), priority: "secondary" },
  { label: t("ledger.list.colStatus") },
];

export function AccountTreeTable({
  id, caption, rows, hrefFor, emptyTitle, emptyHint,
}: {
  id: string;
  caption: string;
  rows: AccountTreeRow[];
  /** Link na detalj konta; bez njega naziv je običan tekst (predložak u adminu, čija konta nemaju aktivnost — `active` izostavljen → „—”). */
  hrefFor?: (row: AccountTreeRow) => string;
  emptyTitle: string;
  emptyHint?: string;
}) {
  const flat = flattenTree(rows);
  return (
    <Table id={id} caption={caption} headers={headers} empty={flat.length === 0} emptyTitle={emptyTitle} emptyHint={emptyHint}>
      {flat.map((r) => {
        // Težina ide na sam tekst: RowLink nosi svoj `font-medium`, koji bi pregazio naslijeđenu težinu reda.
        const label = (
          <span className={r.postable ? undefined : "font-semibold"}>
            <span className="tabular-nums">{r.code}</span> {r.name}
          </span>
        );
        return (
          <tr key={r.id}>
            <Td>
              <span className={`block ${INDENT[Math.min(r.depth, INDENT.length - 1)]}`}>
                {hrefFor ? <RowLink href={hrefFor(r)}>{label}</RowLink> : label}
              </span>
            </Td>
            <Td>{tEnum("accountNature", r.nature)}</Td>
            <Td>{r.postable ? t("ledger.list.postable") : t("ledger.list.summary")}</Td>
            <Td>
              {r.active === undefined
                ? "—"
                : r.active
                  ? t("ledger.list.active")
                  : <StatusBadge status="ACCOUNT_INACTIVE" label={t("ledger.list.inactive")} />}
            </Td>
          </tr>
        );
      })}
    </Table>
  );
}
