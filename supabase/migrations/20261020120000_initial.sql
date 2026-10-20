-- Hebelie on Supabase Postgres.
-- The medspa subscription is the product. A Hebelie.com lead is assigned by hand.
-- Portraits and results are file paths in a private Storage bucket, not bytes in these tables.
-- Row Level Security is on and there are no public policies. The anon key cannot read or write.
-- The server will use the service role later, which bypasses these policies.

create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  website text,
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'canceled')),
  created_at timestamptz not null default now()
);

comment on table accounts is 'One row per medspa. Hebelie.com is also one account.';

create table staff_users (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  email text not null,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  unique (account_id, email)
);

create table staff_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references staff_users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references accounts (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'canceled')),
  generation_limit_month integer not null default 100 check (generation_limit_month >= 0),
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

comment on table subscriptions is 'The SaaS plan for a medspa. One subscription per account.';

create table domains (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  origin text not null,
  created_at timestamptz not null default now(),
  unique (account_id, origin)
);

comment on column domains.origin is 'Full origin allowed to load the widget, such as https://clinic.example.';

create table widget_keys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  public_key text not null unique,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table crm_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  provider text not null default 'webhook' check (provider in ('webhook')),
  endpoint_url text not null,
  secret_encrypted text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);

create table treatments (
  id text primary key,
  label text not null
);

insert into treatments (id, label) values
  ('lips', 'Lip filler'),
  ('cheeks', 'Cheek filler'),
  ('botox', 'Botox'),
  ('jawline', 'Jawline contour'),
  ('skin', 'Skin rejuvenation'),
  ('browlift', 'Brow lift'),
  ('facelift', 'Facelift'),
  ('rhino', 'Rhinoplasty');

create table preview_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  photo_path text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on column preview_sessions.photo_path is 'Path in the private previews bucket. The file is deleted when the session expires.';

create table previews (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references preview_sessions (id) on delete cascade,
  account_id uuid not null references accounts (id) on delete cascade,
  treatment_ids text[] not null,
  intensity text not null default 'medium' check (intensity = 'medium'),
  result_path text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (
    cardinality(treatment_ids) between 1 and 3
    and treatment_ids <@ array['lips', 'cheeks', 'botox', 'jawline', 'skin', 'browlift', 'facelift', 'rhino']::text[]
  )
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  channel text not null check (channel in ('site', 'widget')),
  name text not null,
  phone text,
  email text,
  city text not null,
  consent_at timestamptz not null,
  consent_text text not null,
  treatment_ids text[] not null,
  source_url text,
  created_at timestamptz not null default now(),
  check (phone is not null or email is not null),
  check (
    cardinality(treatment_ids) between 1 and 3
    and treatment_ids <@ array['lips', 'cheeks', 'botox', 'jawline', 'skin', 'browlift', 'facelift', 'rhino']::text[]
  )
);

comment on table leads is 'Contact details only. A widget lead belongs to that medspa. A site lead belongs to Hebelie until someone assigns it.';

create table lead_assignments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  clinic_account_id uuid not null references accounts (id) on delete restrict,
  price_cents integer check (price_cents is null or price_cents >= 0),
  note text,
  sent_at timestamptz not null default now()
);

comment on table lead_assignments is 'A manual handoff. Insert a row when a Hebelie.com lead is given to a clinic.';

create table generations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  session_id uuid references preview_sessions (id) on delete set null,
  treatment_ids text[] not null,
  intensity text not null default 'medium' check (intensity = 'medium'),
  status text not null check (status in ('ok', 'error')),
  created_at timestamptz not null default now()
);

comment on table generations is 'One row per preview attempt, used to enforce the monthly limit.';

create table crm_deliveries (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references crm_connections (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  attempt integer not null default 1 check (attempt >= 1),
  response_status integer,
  last_error text,
  created_at timestamptz not null default now()
);

create index leads_account_created_idx on leads (account_id, created_at desc);
create index lead_assignments_lead_idx on lead_assignments (lead_id);
create index generations_account_created_idx on generations (account_id, created_at desc);
create index previews_session_idx on previews (session_id);
create index crm_deliveries_lead_idx on crm_deliveries (lead_id);
create index domains_origin_idx on domains (origin);

alter table accounts enable row level security;
alter table staff_users enable row level security;
alter table staff_sessions enable row level security;
alter table subscriptions enable row level security;
alter table domains enable row level security;
alter table widget_keys enable row level security;
alter table crm_connections enable row level security;
alter table treatments enable row level security;
alter table preview_sessions enable row level security;
alter table previews enable row level security;
alter table leads enable row level security;
alter table lead_assignments enable row level security;
alter table generations enable row level security;
alter table crm_deliveries enable row level security;

insert into storage.buckets (id, name, public)
values ('previews', 'previews', false)
on conflict (id) do nothing;
