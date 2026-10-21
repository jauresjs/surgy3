-- Which clinic site is actually serving the widget.
--
-- last_used_at already said a key was used, but never by whom: the desk's own
-- preview rescans the key every time someone opens the Widget tab, so a key that
-- had never left the desk looked identical to one live on a clinic's site. These
-- two columns record the page that framed the widget instead, and tenancy.ts only
-- writes them for a page that is not one of ours.
alter table widget_keys
  add column last_parent_origin text,
  add column last_parent_at timestamptz;

comment on column widget_keys.last_parent_origin is
  'Origin of the last clinic page that served this widget. Null until one has: our own desk and preview pages are not counted.';

comment on column widget_keys.last_parent_at is
  'When last_parent_origin was last seen. Written with it, never alone.';

-- The value comes from tenancy.ts's normalizeOrigin, so this mirrors the shape
-- check domains already carries rather than inventing a looser one.
alter table widget_keys
  add constraint widget_keys_last_parent_origin_shape
  check (
    last_parent_origin is null
    or last_parent_origin ~ '^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$'
  );
