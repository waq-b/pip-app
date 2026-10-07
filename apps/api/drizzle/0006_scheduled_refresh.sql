-- Scheduled refresh: pg_cron asks the API to refresh.
--
-- Where to call and the job secret live in `private.job_settings`, filled in
-- at deploy time — never in git. Until that row exists the scheduled call does
-- nothing. The work itself runs in Fastify (design rule 5: provider keys are only
-- ever opened there); the database only knocks on the door.
--
-- Schedule: every 30 minutes on weekdays 07:00–21:59 UTC (London, European
-- and US sessions plus their closes), and once a day at 22:00 UTC for the
-- day's final values. Anything off-hours is cheap: the API skips what's fresh.
--
-- Guarded so databases without pg_cron/pg_net (the in-process test database)
-- still apply every migration.

CREATE TABLE IF NOT EXISTS private.job_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  refresh_url text NOT NULL,
  job_secret text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
REVOKE ALL ON private.job_settings FROM PUBLIC, anon, authenticated;--> statement-breakpoint
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_net;
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    EXECUTE $function$
      CREATE OR REPLACE FUNCTION private.request_refresh() RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $body$
      DECLARE
        settings private.job_settings;
      BEGIN
        SELECT * INTO settings FROM private.job_settings LIMIT 1;
        IF NOT FOUND THEN
          RETURN;
        END IF;
        -- The API answers 202 at once, but a sleeping Render instance takes
        -- about a minute to wake, so allow for that rather than pg_net's 2s.
        PERFORM net.http_post(
          url := settings.refresh_url,
          body := '{}'::jsonb,
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-job-secret', settings.job_secret),
          timeout_milliseconds := 90000
        );
      END
      $body$
    $function$;
    EXECUTE 'REVOKE ALL ON FUNCTION private.request_refresh() FROM PUBLIC, anon, authenticated';

    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('pip-refresh-market-hours', 'pip-refresh-daily-close');
    PERFORM cron.schedule('pip-refresh-market-hours', '*/30 7-21 * * 1-5', 'select private.request_refresh()');
    PERFORM cron.schedule('pip-refresh-daily-close', '0 22 * * *', 'select private.request_refresh()');
  END IF;
END
$migration$;
