// Poruka uspjeha za `?msg=` na stranicama knjigovodstva (ključ iz server akcija u chartOfAccounts.ts).
import { t, tf } from "@/lib/i18n";

export function ledgerMessage(msg: string | undefined, params: Record<string, string | number> = {}): string | undefined {
  if (!msg || !/^[a-zA-Z]+$/.test(msg)) return undefined;
  const key = `ledger.msg.${msg}`;
  const text = tf(key, params);
  return text === key || t(key) === key ? undefined : text;
}
