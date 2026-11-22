import { requireActor } from "@/server/actor";
import { DimensionReport } from "../dimension-page";

/** Kartica dobavljača iz knjige (B3a §3.4). */
export default async function SupplierCardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; id?: string }> }) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  return <DimensionReport actor={actor} dim="supplier" sp={await searchParams} />;
}
