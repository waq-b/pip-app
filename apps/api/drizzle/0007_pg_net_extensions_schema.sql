-- pg_net belongs in the `extensions` schema, not `public` (Supabase security
-- advisor). It can't be moved, so reinstall it there. Its functions live in
-- the `net` schema either way, so `private.request_refresh()` is unaffected.
-- Guarded like 0006 for databases without it.
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    DROP EXTENSION pg_net;
    CREATE EXTENSION pg_net WITH SCHEMA extensions;
  END IF;
END
$migration$;
