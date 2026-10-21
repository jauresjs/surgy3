-- Multi-tenant Phase 0.
--
-- Before this migration every public request was pinned to one tenant: the
-- server looked up the account whose slug was the literal string 'hebelie'
-- (hebelieId() in hebelie-api/index.ts). This migration adds only the data a
-- per-request tenant lookup needs.
--
-- Everything here is additive. No table, column or row is dropped, so the
-- Hebelie.com marketplace channel (leads.channel = 'site' plus
-- lead_assignments) and the generic outbound webhook connector both keep
-- working while those product decisions are still open.

-- Per-tenant look and feel, so one deploy can serve many clinics.
alter table accounts
  add column brand_primary text,
  add column brand_accent text,
  add column tagline text,
  add column booking_url text,
  add column logo_path text;

comment on column accounts.brand_primary is 'Hex colour used by the widget for its main action, such as #8b5e3c.';
comment on column accounts.brand_accent is 'Hex colour used by the widget for highlights and gradients.';
comment on column accounts.tagline is 'One line of copy shown above the upload button.';
comment on column accounts.booking_url is 'Where the widget sends a lead after the thanks screen.';
comment on column accounts.logo_path is 'Path in the private previews bucket. The admin media route already serves it.';

-- treatments stays the global catalog. This table is the per-tenant allow-list,
-- so a clinic only ever sees the treatments it actually sells.
create table account_treatments (
  account_id uuid not null references accounts (id) on delete cascade,
  treatment_id text not null references treatments (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (account_id, treatment_id)
);

comment on table account_treatments is 'Treatments a tenant offers. An empty set is read as the full catalog.';

alter table account_treatments enable row level security;

-- Give the live tenant the whole catalog so the current site does not go empty
-- the moment the server starts honouring this table.
insert into account_treatments (account_id, treatment_id, sort_order)
select a.id, t.id, 0
from accounts a
cross join treatments t
where a.slug = 'hebelie'
on conflict (account_id, treatment_id) do nothing;

-- A key is now per install, not per account, so it needs a name an operator can
-- recognise, and a timestamp so a stale key can be spotted.
alter table widget_keys
  add column label text,
  add column last_used_at timestamptz;

comment on column widget_keys.label is 'Human name for this key, such as the clinic site it was pasted into.';

-- An origin is untrusted until someone proves they control it.
alter table domains
  add column verified_at timestamptz;

comment on column domains.verified_at is 'Null until the origin is proven. Only verified origins are trusted for widget traffic.';

alter table domains
  add constraint domains_origin_shape
  check (origin ~ '^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$');

-- Trace a widget lead back to the key that produced it, and pin the exact
-- consent wording the person actually agreed to.
alter table leads
  add column public_key_id uuid references widget_keys (id) on delete set null,
  add column consent_version text not null default 'v1';

comment on column leads.consent_version is 'Version of the consent copy shown at the time of capture.';

create index leads_public_key_idx on leads (public_key_id);
create index account_treatments_account_idx on account_treatments (account_id, sort_order);
