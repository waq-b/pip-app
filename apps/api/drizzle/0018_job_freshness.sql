-- Ops without a pinger.
--
-- Pip is allowed to sleep, so nothing may call the API on a schedule: a
-- liveness check every few minutes is a keep-alive in disguise and spends the
-- free Render hours. Instead the jobs write what they did to `job_runs`, and
-- this check reads those rows from inside the database and emails the owner when
-- work has gone stale, failed, or never happened at all — which is also what an
-- unreachable API looks like, so it doubles as the only liveness check left.
--
-- One email per incident: `private.job_alerts` remembers what has been reported
-- and stays quiet until that job runs cleanly again.
--
-- Guarded so databases without pg_cron/pg_net (the in-process test database)
-- still apply every migration.

ALTER TABLE "job_runs" DROP CONSTRAINT IF EXISTS "job_runs_job";--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_job" CHECK ("job_runs"."job" in ('refresh', 'poll', 'prices', 'facts', 'weekly_build', 'daily_build', 'outcomes'));--> statement-breakpoint

-- Thresholds live here so they can change without a deploy. Resend's key joins
-- the job secret: server-only, never granted to anyone signed in.
ALTER TABLE private.job_settings ADD COLUMN IF NOT EXISTS resend_key text;--> statement-breakpoint
ALTER TABLE private.job_settings ADD COLUMN IF NOT EXISTS ops_email text;--> statement-breakpoint
ALTER TABLE private.job_settings ADD COLUMN IF NOT EXISTS email_from text NOT NULL DEFAULT 'Pip <pip@mail.example.com>';--> statement-breakpoint
ALTER TABLE private.job_settings ADD COLUMN IF NOT EXISTS stale_refresh_minutes integer NOT NULL DEFAULT 75;--> statement-breakpoint
ALTER TABLE private.job_settings ADD COLUMN IF NOT EXISTS weekly_build_by_hour integer NOT NULL DEFAULT 9;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS private.job_alerts (
  job text PRIMARY KEY,
  reason text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  /** The run that cleared it, so an incident is closed by work, not by time. */
  resolved_at timestamptz
);--> statement-breakpoint
REVOKE ALL ON private.job_alerts FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- Which jobs look wrong, and why. Pure SQL and no side effects, so it can be
-- read by hand and tested without pg_cron or pg_net.
CREATE OR REPLACE FUNCTION private.stale_jobs(at timestamptz DEFAULT now())
  RETURNS TABLE (job text, reason text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $body$
DECLARE
  settings private.job_settings;
  london timestamptz;
BEGIN
  SELECT * INTO settings FROM private.job_settings LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  london := at AT TIME ZONE 'Europe/London';

  -- Prices: only judged while the schedule says Pip should have run. Outside
  -- market hours a quiet Pip is a sleeping Pip, which is the point.
  IF extract(isodow FROM london) <= 5
     AND extract(hour FROM london) BETWEEN 8 AND 22 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.job_runs r
      WHERE r.job = 'prices'
        AND r.finished_at IS NOT NULL
        AND cardinality(r.error_steps) = 0
        AND r.finished_at > at - make_interval(mins => settings.stale_refresh_minutes)
    ) THEN
      job := 'prices';
      reason := format('no successful price refresh in %s minutes', settings.stale_refresh_minutes);
      RETURN NEXT;
    END IF;
  END IF;

  -- The Monday build: judged once the morning has passed, on Monday only.
  IF extract(isodow FROM london) = 1
     AND extract(hour FROM london) >= settings.weekly_build_by_hour THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.job_runs r
      WHERE r.job = 'weekly_build'
        AND r.finished_at IS NOT NULL
        AND cardinality(r.error_steps) = 0
        AND r.finished_at::date = (london)::date
    ) THEN
      job := 'weekly_build';
      reason := format('the Monday build had not run by %s:00 London', settings.weekly_build_by_hour);
      RETURN NEXT;
    END IF;
  END IF;

  -- Anything that started and never finished: the API died mid-run, or was
  -- never reachable in the first place.
  FOR job, reason IN
    SELECT r.job, format('%s started at %s and never finished', r.job, to_char(r.started_at, 'YYYY-MM-DD HH24:MI'))
    FROM public.job_runs r
    WHERE r.finished_at IS NULL
      AND r.started_at < at - interval '30 minutes'
      AND r.started_at > at - interval '2 days'
    GROUP BY r.job, r.started_at
  LOOP
    RETURN NEXT;
  END LOOP;
END
$body$;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.stale_jobs(timestamptz) FROM PUBLIC, anon, authenticated;--> statement-breakpoint

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_net;
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    EXECUTE $function$
      CREATE OR REPLACE FUNCTION private.check_job_freshness() RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $body$
      DECLARE
        settings private.job_settings;
        problem record;
        body text;
      BEGIN
        SELECT * INTO settings FROM private.job_settings LIMIT 1;
        IF NOT FOUND OR settings.resend_key IS NULL OR settings.ops_email IS NULL THEN
          RETURN;
        END IF;

        -- Anything healthy again closes its incident, so the next failure can
        -- report itself. Work closes an incident, never the clock.
        UPDATE private.job_alerts a
        SET resolved_at = now()
        WHERE a.resolved_at IS NULL
          AND a.job NOT IN (SELECT s.job FROM private.stale_jobs() s);

        FOR problem IN SELECT s.job, s.reason FROM private.stale_jobs() s LOOP
          -- One email per incident: an open row means the owner has already been told.
          IF EXISTS (
            SELECT 1 FROM private.job_alerts a
            WHERE a.job = problem.job AND a.resolved_at IS NULL
          ) THEN
            CONTINUE;
          END IF;

          INSERT INTO private.job_alerts (job, reason, opened_at, notified_at)
          VALUES (problem.job, problem.reason, now(), now())
          ON CONFLICT (job) DO UPDATE
            SET reason = excluded.reason, opened_at = now(), notified_at = now(), resolved_at = NULL;

          body := format(
            'Pip''s %s job needs a look: %s.' || chr(10) || chr(10) ||
            'Nothing is pinging Pip — this came from the job records in the database, so Pip may simply have failed to wake. Open https://pip.example.com/api/health/jobs for up or down, or the Render logs for detail.',
            problem.job, problem.reason
          );

          PERFORM net.http_post(
            url := 'https://api.resend.com/emails',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || settings.resend_key
            ),
            body := jsonb_build_object(
              'from', settings.email_from,
              'to', jsonb_build_array(settings.ops_email),
              'subject', format('Pip: %s needs a look', problem.job),
              'text', body
            ),
            timeout_milliseconds := 20000
          );
        END LOOP;
      END
      $body$
    $function$;
    EXECUTE 'REVOKE ALL ON FUNCTION private.check_job_freshness() FROM PUBLIC, anon, authenticated';

    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'pip-job-freshness';
    -- Every 20 minutes. It reads two small tables and sends nothing unless
    -- something is wrong, and it never touches Render.
    PERFORM cron.schedule('pip-job-freshness', '*/20 * * * *', 'select private.check_job_freshness()');
  END IF;
END
$migration$;
