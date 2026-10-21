-- Every account gets a widget key it can actually paste somewhere.
--
-- Until now a key only existed if an operator ran SQL by hand (widget/README.md),
-- so a clinic could sign in, be told to embed the widget, and have nothing to
-- embed. This backfills one active key per account that has none, and adds the
-- index the desk's per-account lookup and its cap check both rely on.
--
-- Revoked keys are skipped so nothing that was deliberately killed comes back to
-- life. A key minted here is always a new value, so a snippet that was revoked
-- stays dead even for an account that ends up with a replacement.

insert into widget_keys (account_id, public_key, label)
select
  a.id,
  'pk_live_' || replace(gen_random_uuid()::text, '-', ''),
  'Default'
from accounts a
where not exists (
  select 1 from widget_keys k
  where k.account_id = a.id and k.revoked_at is null
)
-- 112 bits of UUID randomness makes a collision implausible, but a unique
-- violation would abort the whole backfill, so the guard costs nothing.
on conflict (public_key) do nothing;

-- The desk reads active keys for one account on every visit, and key creation
-- counts them first. Both are the same partial scan, and a revoked key is never
-- part of either.
create index widget_keys_account_active_idx
  on widget_keys (account_id)
  where revoked_at is null;

comment on index widget_keys_account_active_idx is 'Active keys per account: what the desk lists and what the per-account cap counts.';
