// Plans/pristupacni-prikaz-plan.md (faza A): lične postavke prikaza — po osobi, samo za sopstveni nalog,
// i svaki izbor bilježi da je jednokratno pitanje odgovoreno.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture } from "./helpers";
import { getUiPreferences, setUiPreferences } from "@/server/services/uiPreferences";
import { AuthError } from "@/server/auth/guards";

describe("uiPreferences", () => {
  it("podrazumijevano: uobičajen tekst, jednostavan prikaz isključen, pitanje još nije postavljeno", async () => {
    const f = await createFixture("uiprefs-default");
    const p = await getUiPreferences(f.president);
    expect(p).toEqual({ textLarge: false, layoutSimple: false, askedAt: null });
  });

  it("upisuje izbor samo na sopstveni nalog i bilježi da je pitanje odgovoreno", async () => {
    const f = await createFixture("uiprefs-set");
    const saved = await setUiPreferences(f.president, { textLarge: true });
    expect(saved.textLarge).toBe(true);
    expect(saved.layoutSimple).toBe(false);
    expect(saved.askedAt).toBeInstanceOf(Date);

    // Drugi korisnik u istom ZEV-u ostaje netaknut.
    const other = await getUiPreferences(f.actorA);
    expect(other).toEqual({ textLarge: false, layoutSimple: false, askedAt: null });

    const u = await prisma.user.findUniqueOrThrow({ where: { id: f.president.userId } });
    expect(u.uiTextLarge).toBe(true);
  });

  it("i izbor uobičajenog teksta se računa kao odgovor na pitanje", async () => {
    const f = await createFixture("uiprefs-normal");
    const saved = await setUiPreferences(f.actorA, { textLarge: false });
    expect(saved.textLarge).toBe(false);
    expect(saved.askedAt).toBeInstanceOf(Date);
  });

  it("bez prijave nema čitanja ni upisa", async () => {
    await expect(getUiPreferences(null as never)).rejects.toBeInstanceOf(AuthError);
    await expect(setUiPreferences(null as never, { textLarge: true })).rejects.toBeInstanceOf(AuthError);
  });
});
