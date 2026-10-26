-- Plans/sjednica-uzivo-biljeske-i-zapisnik-plan.md (v2.54.0): bilješke i zaključci sa sjednice + zapisničar.
-- Aditivno: nova tabela MeetingNote i nullable Meeting.minutesTakerId; stari kod ignoriše novo.
CREATE TYPE "MeetingNoteKind" AS ENUM ('NOTE', 'CONCLUSION');

CREATE TABLE "MeetingNote" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "agendaItemId" TEXT,
    "topic" TEXT,
    "kind" "MeetingNoteKind" NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MeetingNote_meetingId_agendaItemId_position_idx" ON "MeetingNote"("meetingId", "agendaItemId", "position");
CREATE INDEX "MeetingNote_zevId_idx" ON "MeetingNote"("zevId");

ALTER TABLE "MeetingNote" ADD CONSTRAINT "MeetingNote_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeetingNote" ADD CONSTRAINT "MeetingNote_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingNote" ADD CONSTRAINT "MeetingNote_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "AgendaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Meeting" ADD COLUMN "minutesTakerId" TEXT;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_minutesTakerId_fkey" FOREIGN KEY ("minutesTakerId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
