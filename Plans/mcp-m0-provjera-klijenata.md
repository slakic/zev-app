# Faza M-0 — provjera MCP klijenata (Claude Pro, ChatGPT Plus) — uputstvo i rezultati

**Status: ZAVRŠENO 2026-10-31.** Rezultati su u §6, posljedice za plan u §7. ChatGPT web je
izostavljen odlukom korisnika. Dio plana
[`Plans/mcp-platforma-plan.md`](mcp-platforma-plan.md) §8. Cilj: utvrditi šta Claude Pro i ChatGPT
Plus **stvarno** prihvataju za sopstveni MCP konektor, prije nego što se izabere redoslijed faza
(da li OAuth mora ići odmah iza osnove).

## 1. Šta je pripremljeno

Grana **`mcp-probe`** (ne spaja se u `main`, briše se posle provjere) sadrži probni MCP server bez
ijedne veze sa bazom:

| Adresa | Prijava | Svrha |
|---|---|---|
| `https://<preview-adresa>/api/mcp-probe/open` | bez prijave | Da li klijent uopšte radi sa našim serverom |
| `https://<preview-adresa>/api/mcp-probe/token` | `Authorization: Bearer <MCP_PROBE_TOKEN>` | Da li klijent nudi polje za token u zaglavlju; ako ne nudi, da li pokušava OAuth |

- Oba servera imaju jedan alat, **`ping`**, koji samo vrati „Veza radi …“ i vrijeme servera.
- Bez tokena, adresa `/token` vraća 401 sa `WWW-Authenticate` zaglavljem po MCP specifikaciji. Ako
  klijent posle toga traži OAuth metapodatke (`/.well-known/…`), to se vidi u logu: znači da klijent
  očekuje OAuth.
- Svaki zahtjev se upisuje u log Vercela kao red koji počinje sa `[mcp-probe]`: putanja, JSON-RPC
  metod, `user-agent`, verzija protokola i **vrsta i dužina** zaglavlja `Authorization`, nikad
  vrijednost tokena.
- Sve je iza flaga `MCP_PROBE_ENABLED`; bez njega adrese vraćaju 404.

## 2. Priprema preview okruženja (Vi, u Vercelu)

1. **Pushovati granu `mcp-probe`** (ja to radim kad potvrdite). Vercel napravi preview deployment.
2. U Vercelu → projekat → **Settings → Environment Variables** dodati, samo za **Preview** i granu
   `mcp-probe`:
   - `MCP_PROBE_ENABLED` = `true`
   - `MCP_PROBE_TOKEN` = nasumičan niz, npr. rezultat komande ispod (sačuvajte ga, trebaće Vam u
     koracima 3 i 4)
3. **Deployment Protection:** ako su preview deploymenti zaštićeni prijavom u Vercel („Vercel
   Authentication“), Claude i ChatGPT ne mogu do servera. Za ovu provjeru zaštitu privremeno isključite
   za preview (Settings → Deployment Protection), pa je posle vratite.
4. Ponovo pokrenuti deployment grane (Redeploy), da se varijable primijene.
5. Javite mi preview adresu; ja provjerim da obje adrese odgovaraju prije nego što krenete.

```bash
openssl rand -hex 24
```

## 3. Claude Pro (claude.ai i Claude Desktop)

Nazivi menija se mijenjaju; ako nešto ne odgovara, zabilježite šta vidite.

1. claude.ai → **Settings → Connectors → Add custom connector**.
2. **Probni konektor bez prijave:** naziv „ZEV probe open“, adresa `…/api/mcp-probe/open`. Sačuvajte,
   pa u novom razgovoru napišite: *„Pozovi alat ping sa porukom zdravo.“*
3. **Probni konektor sa tokenom:** naziv „ZEV probe token“, adresa `…/api/mcp-probe/token`.
   Provjerite postoji li u naprednim podešavanjima polje za **zaglavlje** ili **API ključ / token**.
   - Ako postoji: upišite `Authorization` = `Bearer <MCP_PROBE_TOKEN>` (ili samo token, ako je polje
     za token), pa ponovite poziv `ping`.
   - Ako ne postoji: pokušajte da sačuvate konektor i zabilježite šta Claude uradi (poruka o grešci,
     pokušaj prijave i sl.).
4. Ako koristite i **Claude Desktop**, provjerite da li se konektori iz claude.ai tamo pojavljuju sami.

## 4. ChatGPT Plus

1. ChatGPT → **Settings → Apps & Connectors** (ili „Connectors“) → **Advanced settings** → uključite
   **Developer mode**. **Ako ta opcija ne postoji na Plus planu, zabilježite to — to je najvažniji
   rezultat za ChatGPT.**
2. **Create** (novi konektor): naziv „ZEV probe open“, adresa `…/api/mcp-probe/open`, autentifikacija
   „No authentication“ (ako se nudi). U razgovoru uključite konektor i tražite poziv alata `ping`.
3. Ponovite za `…/api/mcp-probe/token` i zabilježite **koje vrste autentifikacije** ChatGPT nudi
   (OAuth, API ključ, bez prijave) i da li neka od njih prima naš token.

## 5. Claude Code (opciono, kontrolni test)

Potvrđuje da server radi sa tokenom kad klijent dozvoljava zaglavlje:

```bash
claude mcp add --transport http zev-probe https://<preview-adresa>/api/mcp-probe/token --header "Authorization: Bearer <MCP_PROBE_TOKEN>"
```

Zatim u Claude Code: *„Pozovi alat ping iz zev-probe.“*

## 6. Rezultati (2026-10-31)

Probni server na preview deploymentu grane `mcp-probe` (`zev-eb55m9evt-zev8.vercel.app`); provjeru u
klijentima radio je korisnik u svojim nalozima, a ja sam prije toga provjerio obje adrese (`curl`:
`initialize`, `tools/list`, `ping`; 401 sa `WWW-Authenticate` bez tokena i sa pogrešnim tokenom).

| Klijent i plan | Sopstveni MCP | Bez prijave | Token u zaglavlju | Traži OAuth | Napomena |
|---|---|---|---|---|---|
| **claude.ai — Claude Pro** | ✓ (Settings → Connectors → Add custom connector) | ✓ `ping` radi | ✗ — nema polja za zaglavlje ili token, nudi se samo **OAuth Client ID** | **✓** | Na 401 Claude odmah traži OAuth metapodatke i pokušava **Dynamic Client Registration**; poruka: *„Couldn't register with … sign-in service. You can try again, or add an OAuth Client ID in the connector settings.“* |
| **OpenAI aplikacija sa „Plugins → Add → Add MCP server“** — Plus (vjerovatno Codex; tačan naziv nije potvrđen) | ✓ | ✓ `ping` radi | **✓ radi** (polje „Headers“: `Authorization: Bearer …`) | ✗ | Obrazac nudi i STDIO, „Bearer token env var“ i „Headers from environment variables“ — alat za programere na računaru, ne običan chat |
| ChatGPT web (chatgpt.com) — Plus | — | — | — | — | **Nije provjereno** (odluka korisnika) |
| Claude Code | nije rađeno | | | | Format komande poznat; nije bilo potrebe |

## 7. Šta rezultat znači za plan

- **Claude Pro traži OAuth** → redoslijed iz plana platforme ostaje: P-A → O-A → **P-B (OAuth)** →
  O-B → O-C. Opcija „OAuth tek na kraju“ otpada.
- **OAuth mora podržati Dynamic Client Registration** (RFC 7591): Claude ga koristi automatski. Ručni
  „OAuth Client ID“ u Claude-u je rezerva, ne glavni put.
- **Token iz „Povezani asistenti“ ima stvarnu upotrebu od Faze P-A**: OpenAI aplikacija koju je
  korisnik koristio i Claude Code ga prihvataju u zaglavlju. Nije samo pilot.
- **ChatGPT web ostaje otvoren:** uputstvo i prodaja ne obećavaju ChatGPT web dok se ne provjeri.
- **Server je kompatibilan sa oba klijenta** (Streamable HTTP, `initialize`, `tools/list`,
  `tools/call`), pa se izbor biblioteke u P-A ne mijenja zbog klijenata.

## 8. Čišćenje posle provjere

- Obrisati granu `mcp-probe` (lokalno i na GitHubu) i preview deployment.
- Obrisati `MCP_PROBE_ENABLED` i `MCP_PROBE_TOKEN` iz Vercela.
- Vratiti Deployment Protection za preview, ako je bila isključena.
- Ukloniti probne konektore iz claude.ai i ChatGPT-ja.
- Upisati rezultate u `Plans/mcp-platforma-plan.md` §5/§8 i u ovaj dokument.
