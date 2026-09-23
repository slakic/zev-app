import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { getLiveMeetingState, recordAttendance } from "@/server/services/meetings";
import { LiveShell } from "@/components/live-shell";
import { RollCall } from "@/components/roll-call";

// Outside (app): no NavShell, no maybeActor() from that layout — every entry point here
// (this page and the one server action below) must independently call requireActor
// (Plans/live-meeting-mode-plan.md §2.4, risk 8). "PRESIDENT" and "ACCOUNTANT" match the
// widened service-layer guard from Faza 0 (§2.7, P7) — this route must never be narrower
// than the services it calls.
async function markAttendanceAction(formData: FormData) {
  "use server";
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const meetingId = String(formData.get("meetingId"));
  await recordAttendance(actor, {
    meetingId,
    partyId: String(formData.get("partyId")),
    present: formData.get("present") === "true",
  });
  revalidatePath(`/uzivo/${meetingId}`);
}

export default async function LiveMeetingPage({ params }: { params: Promise<{ meetingId: string }> }) {
  const { meetingId } = await params;
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const state = await getLiveMeetingState(actor, meetingId);

  return (
    <LiveShell title={state.title} backHref={`/skupstina/${meetingId}`}>
      <RollCall
        meetingId={meetingId}
        voters={state.voters}
        presentCount={state.presentCount}
        absentCount={state.absentCount}
        action={markAttendanceAction}
      />
    </LiveShell>
  );
}
