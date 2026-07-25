-- 0013_token_revocation — make it possible to actually revoke a session.
--
-- Auth is a stateless JWT valid for 12h (employee) / 24h (admin), and logout only clears
-- the cookie client-side. So deactivating an employee did NOT end their access: an
-- offboarded person — or anyone holding a stolen cookie — kept working access to personal
-- HR data until the token happened to expire.
--
-- Each identity now carries a token version. It is stamped into the token at login and
-- checked on every request; bumping the column instantly invalidates every token issued
-- before the bump.
ALTER TABLE employees   ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
