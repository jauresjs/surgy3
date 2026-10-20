-- Step 1: staff can sign in with email + password later.
-- No API or UI uses this yet.

alter table staff_users add column password_hash text;
comment on column staff_users.password_hash is 'PBKDF2-SHA256 password hash. The password is never stored.';

create unique index staff_users_email_lower_idx on staff_users (lower(email));
