// Ograničenja učestalosti za /api/mcp: promašeni tokeni po IP adresi i pozivi po vezi. U memoriji,
// u najboljoj namjeri — isti lagani obrazac kao bankSms.ts i users.ts. Na serverless okruženju važi
// po instanci; granicu štete ipak postavlja dizajn (opseg veze, alati bez nepovratnih posljedica).
type Entry = { count: number; first: number };

const AUTH_FAIL_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAIL_MAX = 20;
const CALL_WINDOW_MS = 60 * 1000;
const CALL_MAX = 120;

const authFailures = new Map<string, Entry>();
const calls = new Map<string, Entry>();

function allows(map: Map<string, Entry>, key: string, windowMs: number, max: number): boolean {
  const e = map.get(key);
  return !e || Date.now() - e.first > windowMs || e.count < max;
}
function record(map: Map<string, Entry>, key: string, windowMs: number) {
  const now = Date.now();
  const e = map.get(key);
  if (!e || now - e.first > windowMs) map.set(key, { count: 1, first: now });
  else e.count++;
}

export const mcpAuthFailuresAllowed = (ipKey: string) => allows(authFailures, ipKey, AUTH_FAIL_WINDOW_MS, AUTH_FAIL_MAX);
export const recordMcpAuthFailure = (ipKey: string) => record(authFailures, ipKey, AUTH_FAIL_WINDOW_MS);

/** Broji poziv i vraća false kad veza prelazi dozvoljeni broj poziva u minuti. */
export function consumeMcpCall(connectionId: string): boolean {
  if (!allows(calls, connectionId, CALL_WINDOW_MS, CALL_MAX)) return false;
  record(calls, connectionId, CALL_WINDOW_MS);
  return true;
}

/** Samo za testove. */
export function resetMcpRateLimits() {
  authFailures.clear();
  calls.clear();
}
