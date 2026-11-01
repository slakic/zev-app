import "server-only";
// Stavke menija naloga koje školjke prosljeđuju u NavShell/AccountMenu. Samo prikaz: stranice i servisi
// sami provjeravaju pristup.
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import type { AccountMenuLink } from "@/components/account-menu";

/**
 * „Moji podaci” (samo tenant školjka, kad vlasnik nema „Podešavanja” u bočnom meniju) i „Povezani asistenti”
 * (kad je MCP uključen). Admin i čarobnjak dobijaju samo asistente.
 */
export function accountLinksFor(opts: { includeMyData: boolean }): AccountMenuLink[] {
  const links: AccountMenuLink[] = [];
  if (opts.includeMyData) links.push({ href: "/podesavanja", label: t("nav.myData"), icon: "sliders" });
  if (getEnv().MCP_ENABLED === "true") links.push({ href: "/nalog/asistenti", label: t("nav.assistants"), icon: "plug" });
  return links;
}
