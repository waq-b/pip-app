-- The freshness check's morning grace (Phase 6 close-out, found 2026-09-21).
-- "Pip: prices needs a look" arrived at 08:00 London on weekday mornings: the
-- check starts judging prices at 08:00, the same minute the first refresh of
-- the day starts, so it saw last night's prices. Judging starts at 09:00 now.
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
  -- market hours a quiet Pip is a sleeping Pip, which is the point. From 09:00,
  -- not 08:00: the first morning refresh starts at 08:00 London in summer, and
  -- a check at that minute saw last night's prices and cried wolf (0022).
  IF extract(isodow FROM london) <= 5
     AND extract(hour FROM london) BETWEEN 9 AND 22 THEN
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
REVOKE ALL ON FUNCTION private.stale_jobs(timestamptz) FROM PUBLIC, anon, authenticated;
