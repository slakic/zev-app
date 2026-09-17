"use client";

import { useEffect } from "react";
import Link from "next/link";

// Root-level fallback. Most page-level crashes are caught closer to the source by
// src/app/(app)/error.tsx, which keeps the nav chrome visible — this one only fires
// for errors thrown *above* that boundary, chiefly requireSuperAdminActor() throwing
// directly inside admin/layout.tsx (a layout's own errors are never caught by an error
// boundary defined at that same segment, only by one further up the tree). No layout
// is guaranteed to be mounted here, so this renders a fully self-contained page rather
// than assuming NavShell or the admin header exist.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200/80 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Nešto nije uspjelo</h1>
        <p className="mt-2 text-sm text-slate-600">
          Ova stranica se nije mogla prikazati — najčešći razlog je da vaš nalog nema
          ovlašćenje za ovu radnju. Vratite se na početnu ili probajte ponovo.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700"
          >
            Nazad na početnu
          </Link>
          <button type="button" onClick={reset} className="text-sm font-medium text-blue-700 hover:underline">
            Pokušaj ponovo
          </button>
        </div>
      </div>
    </div>
  );
}
