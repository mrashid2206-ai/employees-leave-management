-- 0016_location_state — record HOW confidently a location was determined, not just a
-- boolean off-site flag.
--
-- Why: 48% of check-ins arrive with no coordinates (location permission denied, desktops
-- with no GPS, or the fix timing out indoors). The old rule treated "no GPS and the IP does
-- not match the office" as proof of being off-site — so an employee at their own desk on
-- mobile data was flagged identically to one working from home. In production that was 89
-- of 150 off-site rows: the majority of the report could not be substantiated.
--
-- The new rule is asymmetric on purpose. Matching the office IP is strong evidence of being
-- ON the premises; failing to match it is weak, because mobile data hands out a different
-- address every time. Only GPS can place someone off-site.

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS check_in_location  VARCHAR(12),
  ADD COLUMN IF NOT EXISTS check_out_location VARCHAR(12);

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_check_in_location_check;
ALTER TABLE attendance
  ADD CONSTRAINT attendance_check_in_location_check
  CHECK (check_in_location IS NULL OR check_in_location IN ('onsite', 'offsite', 'unverified'));

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_check_out_location_check;
ALTER TABLE attendance
  ADD CONSTRAINT attendance_check_out_location_check
  CHECK (check_out_location IS NULL OR check_out_location IN ('onsite', 'offsite', 'unverified'));

-- Backfill from what was already captured. The coordinates and IPs were stored all along,
-- so history can be reclassified rather than lost — which is what demotes those 89 rows
-- from "off-site" to "unverified".
WITH cfg AS (SELECT office_ip FROM settings ORDER BY id LIMIT 1)
UPDATE attendance a
   SET check_in_location = CASE
         WHEN a.check_in IS NULL                       THEN NULL
         -- Coordinates present: the stored is_offsite already reflects the radius test.
         WHEN a.check_in_lat IS NOT NULL               THEN CASE WHEN a.is_offsite THEN 'offsite' ELSE 'onsite' END
         WHEN a.check_in_ip = (SELECT office_ip FROM cfg) THEN 'onsite'
         ELSE 'unverified'
       END,
       check_out_location = CASE
         WHEN a.check_out IS NULL                       THEN NULL
         WHEN a.check_out_lat IS NOT NULL               THEN CASE WHEN a.is_offsite_checkout THEN 'offsite' ELSE 'onsite' END
         WHEN a.check_out_ip = (SELECT office_ip FROM cfg) THEN 'onsite'
         ELSE 'unverified'
       END;

-- Bring the booleans in line with the corrected meaning: is_offsite now means
-- "GPS-confirmed off-site" and nothing weaker. This is the row-level correction — the
-- previously-flagged IP-only rows become false here and 'unverified' above.
UPDATE attendance
   SET is_offsite = (check_in_location = 'offsite')
 WHERE check_in IS NOT NULL;

UPDATE attendance
   SET is_offsite_checkout = (check_out_location = 'offsite')
 WHERE check_out IS NOT NULL;
