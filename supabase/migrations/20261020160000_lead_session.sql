-- Link a lead to the preview visit so the admin desk can show the portrait
-- and the generated images. The lead row still stores no image bytes.
-- private_settings holds server secrets. Row Level Security is on and the
-- public API cannot read the table.

alter table leads add column session_id uuid references preview_sessions (id) on delete set null;
create index leads_session_idx on leads (session_id);
comment on column leads.session_id is 'Preview visit this lead came from. Photos live on that session, not on the lead row.';

create table private_settings (
  key text primary key,
  value text not null
);
alter table private_settings enable row level security;
revoke all on table private_settings from anon, authenticated;

insert into accounts (name, slug, status)
values ('Hebelie', 'hebelie', 'active')
on conflict (slug) do nothing;
