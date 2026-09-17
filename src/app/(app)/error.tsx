"use client";

import { useEffect } from "react";
import { Card, BtnLink } from "@/components/ui";

// Catches any error thrown while rendering a page under (app) — most commonly a
// ForbiddenError from requireActor(role) when the signed-in account doesn't hold that
// role in the currently active ZEV (e.g. a stale tab from before a role change, or a
// link meant for a management account). Next.js strips the real error message in
// production builds (see error.message below), so this can't reliably tell a 403 apart
// from any other crash — it gives one honest, calm message instead of guessing. The
// surrounding (app)/layout.tsx (nav sidebar, ZEV switcher, logout) stays mounted around
// this boundary, so the user always has a way out.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-12">
      <Card title="Nešto nije uspjelo">
        <p className="text-sm text-slate-600">
          Ova stranica se nije mogla prikazati. Najčešći razlog je da vaš nalog nema
          ovlašćenje za ovu radnju u trenutno izabranom ZEV-u — provjerite koji je ZEV
          aktivan (gore desno) ili se obratite predsjedniku. Ako se greška ponavlja,
          probajte se ponovo prijaviti.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <BtnLink href="/" variant="primary">Nazad na početnu</BtnLink>
          <button type="button" onClick={reset} className="text-sm font-medium text-blue-700 hover:underline">
            Pokušaj ponovo
          </button>
        </div>
      </Card>
    </div>
  );
}
