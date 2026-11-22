import { requireActor } from "@/server/actor";
import { DimensionReport } from "../dimension-page";

/** Kartica vlasnika iz knjige (B3a §3.4). */
export default async function OwnerCardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; id?: string }> }) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  return <DimensionReport actor={actor} dim="party" sp={await searchParams} />;
}
