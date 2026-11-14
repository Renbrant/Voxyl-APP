PRAGMA foreign_keys = ON;

-- 0008_report_moderation.sql
--
-- Supports the authenticated POST /api/reports endpoint (issue #55).
--
-- 1. Imported or legacy rows that would violate the new uniqueness rule are
--    marked as duplicates first, so the index can be created on production data.
-- 2. A reporter can have only one open report per piece of content. The Worker
--    relies on this index (INSERT ... ON CONFLICT DO NOTHING) to stay idempotent
--    under concurrent submissions.
-- 3. A status index for the admin moderation queue already exists
--    (idx_reports_status in 0002); the composite index below serves the queue
--    ordered by creation date.

UPDATE reports
SET status = 'duplicate',
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'open'
  AND reporter_id IS NOT NULL
  AND content_type IS NOT NULL
  AND content_id IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid)
    FROM reports
    WHERE status = 'open'
      AND reporter_id IS NOT NULL
      AND content_type IS NOT NULL
      AND content_id IS NOT NULL
    GROUP BY reporter_id, content_type, content_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_one_open_per_reporter_content
  ON reports (reporter_id, content_type, content_id)
  WHERE status = 'open'
    AND reporter_id IS NOT NULL
    AND content_type IS NOT NULL
    AND content_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reports_status_created_at
  ON reports (status, created_at);
