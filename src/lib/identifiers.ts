// JIB i broj transakcijskog računa (BiH) — jedno mjesto za pravila formata, koje koriste i
// servisi (upsertZev, createTenant, createAccount, updateAccount) i nacrt onboardinga
// (Plans/zev-onboarding-wizard-plan.md, D5). Čiste funkcije, bez baze.

/** Uklanja razmake i crtice kojima se brojevi obično pišu ("555-10000515469-32"). */
export function compactIdentifier(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Ostatak dijeljenja niza cifara sa 97, cifru po cifru — broj od 16+ cifara ne staje u
 * Number bez gubitka preciznosti, a BigInt nije potreban za ovako jednostavan račun.
 */
function mod97(digits: string): number {
  let rest = 0;
  for (const ch of digits) rest = (rest * 10 + Number(ch)) % 97;
  return rest;
}

/**
 * Transakcijski račun BiH: 16 cifara (banka 3 + organizacioni dio 3 + račun 8 + kontrolne 2),
 * kontrolne cifre po ISO 7064 MOD 97-10 — cijeli broj po modulu 97 mora dati 1
 * (Instrukcija o strukturi računa za obavljanje platnih transakcija, CBBiH, član 2).
 */
export function isValidBankAccount(raw: string): boolean {
  const s = compactIdentifier(raw);
  if (/^\d{16}$/.test(s)) return mod97(s) === 1;
  // IBAN: BA + 2 kontrolne + 16 cifara računa; ISO 13616 — prva četiri znaka na kraj, B=11, A=10.
  if (/^BA\d{18}$/.test(s)) return mod97(`${s.slice(4)}1110${s.slice(2, 4)}`) === 1 && mod97(s.slice(4)) === 1;
  return false;
}

/**
 * JIB: tačno 13 cifara. Kontrolna cifra se ne provjerava — zvanični algoritam nije javno
 * objavljen (pravilnik PU RS kaže samo da je deveta cifra kontrolna), a pogrešan algoritam bi
 * odbijao ispravne brojeve u cijeloj aplikaciji.
 */
export function isValidJib(raw: string): boolean {
  return /^\d{13}$/.test(compactIdentifier(raw));
}

export function assertBankAccount(raw: string): void {
  if (!isValidBankAccount(raw)) {
    throw new Error("Broj računa nije ispravan: očekuje se 16 cifara (ili IBAN BA…) sa ispravnim kontrolnim brojem.");
  }
}

export function assertJib(raw: string): void {
  if (!isValidJib(raw)) throw new Error("JIB mora imati tačno 13 cifara.");
}
