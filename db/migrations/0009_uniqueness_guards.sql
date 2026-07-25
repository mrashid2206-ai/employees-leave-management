-- 0009_uniqueness_guards — move the last two UNIQUE indexes out of the runtime
-- self-heal (src/lib/ensure-schema.ts, now deleted) and into the migration runner.
--
-- These were the only pieces of schema the self-heal owned that migrations did not.
-- The self-heal swallowed failures, so a database that already had duplicates simply
-- never got the index — dedupe first, then lock uniqueness in for good.

-- Leave types: keep the lowest id per name_en and repoint any leave requests that
-- referenced a duplicate, so no request is orphaned by the delete.
UPDATE leave_requests lr
   SET leave_type_id = keep.min_id
  FROM (SELECT MIN(id) AS min_id, name_en FROM leave_types GROUP BY name_en) keep
  JOIN leave_types lt ON lt.name_en = keep.name_en
 WHERE lr.leave_type_id = lt.id
   AND lr.leave_type_id <> keep.min_id;

DELETE FROM leave_types lt
 WHERE lt.id <> (SELECT MIN(id) FROM leave_types x WHERE x.name_en = lt.name_en);

-- Holidays: same date declared twice is always a data-entry duplicate; keep the first.
DELETE FROM holidays h
 WHERE h.id <> (SELECT MIN(id) FROM holidays x WHERE x.date = h.date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_types_name_en ON leave_types(name_en);
CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays_date ON holidays(date);

-- Tardiness: one row per employee per day. This index used to be created on every
-- runDailyAutomation() call. It matters more than it looks — each tardiness row
-- subtracts leave_deducted from the employee's balance, so a duplicate row is a
-- double charge against annual leave.
--
-- Refund the leave charged by the rows we are about to drop, so balances stay
-- consistent with the tardiness records that survive.
UPDATE employees e
   SET leave_balance = e.leave_balance + dup.refund,
       updated_at = NOW()
  FROM (
    SELECT employee_id, SUM(leave_deducted) AS refund
      FROM tardiness_log t
     WHERE t.id <> (SELECT MIN(id) FROM tardiness_log x
                     WHERE x.employee_id = t.employee_id AND x.date = t.date)
     GROUP BY employee_id
  ) dup
 WHERE e.id = dup.employee_id
   AND dup.refund > 0;

DELETE FROM tardiness_log t
 WHERE t.id <> (SELECT MIN(id) FROM tardiness_log x
                 WHERE x.employee_id = t.employee_id AND x.date = t.date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tardiness_unique ON tardiness_log (employee_id, date);
