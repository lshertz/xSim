-- Portal hardening.
-- internal = 1 marks the xSim team's own company. Only its members can hold the Admin or Editor role,
-- so a customer account can never be given access to another customer's data by mistake.
ALTER TABLE companies ADD COLUMN internal INTEGER NOT NULL DEFAULT 0;
UPDATE companies SET internal = 1 WHERE name = 'xSim';

-- Failed two-factor codes are counted separately from failed passwords, with lockouts that grow
-- each time (15 minutes, 30, 60, ... up to 24 hours) until a successful sign-in.
ALTER TABLE users ADD COLUMN mfa_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mfa_locks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mfa_locked_until TEXT;

-- When the password was last set from a setup or reset link (limits how long setup can be resumed).
ALTER TABLE users ADD COLUMN password_set_at TEXT;
