// Lične postavke prikaza (Plans/pristupacni-prikaz-plan.md). Po osobi (User), ne po ZEV-u —
// isti čovjek ne čita bolje u drugom ZEV-u, a postavka mora važiti na svakom uređaju (D-P1 A).
// Bez audit unosa: to je izbor prikaza, ne poslovna radnja (isto kao suženi meni).
import { prisma } from "@/lib/prisma";
import { requireAnyUser, type Actor } from "@/server/auth/guards";

export type UiPreferences = {
  textLarge: boolean;
  /** Faza B („Jednostavan prikaz”) — čuva se, ali UI ga još ne nudi. */
  layoutSimple: boolean;
  askedAt: Date | null;
};

export async function getUiPreferences(actor: Actor): Promise<UiPreferences> {
  const a = requireAnyUser(actor);
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: a.userId },
    select: { uiTextLarge: true, uiLayoutSimple: true, uiPrefsAskedAt: true },
  });
  return { textLarge: u.uiTextLarge, layoutSimple: u.uiLayoutSimple, askedAt: u.uiPrefsAskedAt };
}

/** Uvijek samo za sopstveni nalog — userId dolazi iz Actor-a, nikad iz unosa. Svaki izbor
 *  (i iz jednokratnog pitanja i iz profila) bilježi da je pitanje odgovoreno. */
export async function setUiPreferences(
  actor: Actor,
  prefs: { textLarge?: boolean; layoutSimple?: boolean },
): Promise<UiPreferences> {
  const a = requireAnyUser(actor);
  const u = await prisma.user.update({
    where: { id: a.userId },
    data: {
      ...(prefs.textLarge === undefined ? {} : { uiTextLarge: prefs.textLarge }),
      ...(prefs.layoutSimple === undefined ? {} : { uiLayoutSimple: prefs.layoutSimple }),
      uiPrefsAskedAt: new Date(),
    },
    select: { uiTextLarge: true, uiLayoutSimple: true, uiPrefsAskedAt: true },
  });
  return { textLarge: u.uiTextLarge, layoutSimple: u.uiLayoutSimple, askedAt: u.uiPrefsAskedAt };
}
