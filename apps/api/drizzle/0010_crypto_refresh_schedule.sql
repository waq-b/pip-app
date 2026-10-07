-- Crypto refresh around the clock .
--
-- Stocks keep their schedule (0006). Crypto never closes, so outside those
-- hours — weekday nights and all weekend — pg_cron asks for a refresh every
-- hour, but only when someone actually holds crypto: each call wakes the free
-- Render instance, and its free hours are limited.
--
-- Guarded like 0006, so databases without pg_cron/pg_net still apply it.

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    EXECUTE $function$
      CREATE OR REPLACE FUNCTION private.request_crypto_refresh() RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $body$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM public.holdings h
          JOIN public.instruments i ON i.id = h.instrument_id
          WHERE i.type = 'CRYPTO'
        ) THEN
          PERFORM private.request_refresh();
        END IF;
      END
      $body$
    $function$;
    EXECUTE 'REVOKE ALL ON FUNCTION private.request_crypto_refresh() FROM PUBLIC, anon, authenticated';

    PERFORM cron.unschedule(jobid) FROM cron.job
      WHERE jobname IN ('pip-refresh-crypto-weeknights', 'pip-refresh-crypto-weekends');
    -- 22:00 already runs daily (0006); weekday 07:00–21:59 is covered every 30 minutes.
    PERFORM cron.schedule('pip-refresh-crypto-weeknights', '0 0-6,23 * * 1-5', 'select private.request_crypto_refresh()');
    PERFORM cron.schedule('pip-refresh-crypto-weekends', '0 0-21,23 * * 0,6', 'select private.request_crypto_refresh()');
  END IF;
END
$migration$;
