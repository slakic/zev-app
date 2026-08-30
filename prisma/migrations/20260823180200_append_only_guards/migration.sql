-- Append-only enforcement at the database level.
-- Votes, audit events and payment allocations may never be updated or deleted,
-- not even by application bugs or privileged application roles.
-- (Single-quoted function body: the migration runner executes statements
--  one by one and does not parse dollar-quoted strings.)

CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger AS '
BEGIN
  RAISE EXCEPTION ''% rows are append-only (attempted %)'', TG_TABLE_NAME, TG_OP;
END;
' LANGUAGE plpgsql;

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TRIGGER vote_append_only
  BEFORE UPDATE OR DELETE ON "Vote"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TRIGGER payment_allocation_append_only
  BEFORE UPDATE OR DELETE ON "PaymentAllocation"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
