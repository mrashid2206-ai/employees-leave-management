-- 0019_leave_attachments — medical certificates (and other supporting documents) on
-- leave requests.
--
-- Why: sick leave over the threshold already requires notes "e.g. medical certificate
-- reference", but there was nowhere to put the certificate itself, so the admin deciding
-- the request had a typed reference and nothing to check it against.
--
-- Stored in Postgres, not on disk (owner's decision): the container filesystem does not
-- survive a redeploy, and a row lives and dies with its leave (ON DELETE CASCADE). The
-- caps keep this table small: 5 MB a file, 5 files a request, PDF/JPEG/PNG only. The
-- service enforces those and checks the type from the bytes; the constraints below are
-- the backstop.
CREATE TABLE IF NOT EXISTS leave_attachments (
  id SERIAL PRIMARY KEY,
  leave_request_id INT NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(32) NOT NULL
    CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes INT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  data BYTEA NOT NULL,
  -- Admin username or employee id, as audit_log.user_id records it.
  uploaded_by TEXT NOT NULL,
  uploaded_by_role VARCHAR(16) NOT NULL CHECK (uploaded_by_role IN ('admin', 'employee')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (octet_length(data) = size_bytes)
);

CREATE INDEX IF NOT EXISTS idx_leave_attachments_leave ON leave_attachments (leave_request_id);

-- PDFs, JPEGs and PNGs are already compressed; EXTERNAL keeps the value out of line in
-- TOAST without Postgres first spending CPU trying to compress it again.
ALTER TABLE leave_attachments ALTER COLUMN data SET STORAGE EXTERNAL;
