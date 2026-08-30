-- Organi ZEV: upravni odbor (board) membership + board sjednice.
-- See LEGAL_AND_FINANCIAL_ASSUMPTIONS.md §Organi ZEV.

-- OfficeTerm can now also represent upravni odbor membership (multi-holder,
-- unlike the single-holder PRESIDENT/ACCOUNTANT roles).
ALTER TYPE "OfficeRole" ADD VALUE 'BOARD_MEMBER';

-- A sjednica now belongs to one of two organs: the assembly (skupština) or
-- the management board (upravni odbor). Existing meetings default to
-- ASSEMBLY, preserving current behavior.
CREATE TYPE "MeetingBody" AS ENUM ('ASSEMBLY', 'BOARD');

ALTER TABLE "Meeting" ADD COLUMN "body" "MeetingBody" NOT NULL DEFAULT 'ASSEMBLY';
