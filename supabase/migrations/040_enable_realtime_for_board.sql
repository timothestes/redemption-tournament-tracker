-- Enable Supabase Realtime for the projector board.
--
-- Why: the projector board (/board) is the app's first Realtime consumer. The
-- supabase_realtime publication currently contains zero tables, so a client
-- .subscribe() on rounds/tournaments would receive no change events. This adds
-- both tables to the publication and sets REPLICA IDENTITY FULL so UPDATE/DELETE
-- payloads carry old-row values (lets the client confirm an event belongs to a
-- tournament it is already showing). RLS still governs which rows are delivered.

ALTER PUBLICATION supabase_realtime ADD TABLE rounds, tournaments;

ALTER TABLE rounds REPLICA IDENTITY FULL;
ALTER TABLE tournaments REPLICA IDENTITY FULL;
