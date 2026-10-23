-- What the installed button says, where it sits and how it is coloured.
--
-- The desk's Install tab used to hand out a fixed line. It now configures the
-- install, so the three settings that line carried by hand need somewhere to
-- live. They sit on the key rather than on the account because one clinic can
-- paste the widget on two sites — a booking page and a partner's blog — and want
-- a different sentence in each footer. The brand colours stay on the account
-- (they arrived with 20261021120000_multi_tenant.sql): a clinic has one brand.
--
-- Every column carries a default that matches what the loader already used, so
-- the keys that exist today keep rendering exactly as they did: no backfill, and
-- no window in which a live widget loses its wording.

alter table widget_keys
  add column cta_label text not null default 'Preview a treatment',
  add column launcher_position text not null default 'bottom-right',
  add column theme text not null default 'light';

comment on column widget_keys.cta_label is
  'Text on the floating launcher. Widget/embed.js re-reads it from /widget/config, so an edit in the desk reaches a pasted snippet without repasting.';

comment on column widget_keys.launcher_position is
  'Which corner the launcher sits in. The loader also accepts the older "left" spelling in a pre-existing line.';

comment on column widget_keys.theme is
  'Chrome theme for the launcher and its panel. light and dark are fixed; auto follows the visitor''s prefers-color-scheme. The frame itself stays branded by the account.';

-- The desk caps the field at 40 characters and the loader slices to the same
-- number, so a row outside this range could only come from a hand-written update.
-- A newline is refused as well: the label travels in the installer's URL, where a
-- line break would split the tag.
alter table widget_keys
  add constraint widget_keys_cta_label_shape
  check (
    char_length(btrim(cta_label)) between 1 and 40
    and position(chr(10) in cta_label) = 0
    and position(chr(13) in cta_label) = 0
  ),
  add constraint widget_keys_launcher_position_allowed
  check (launcher_position in ('bottom-right', 'bottom-left')),
  add constraint widget_keys_theme_allowed
  check (theme in ('light', 'dark', 'auto'));

-- Brand colours are written by the desk's configure call, which validates a strict
-- six-digit hex before it reaches the column. The constraint is the same shape, so a
-- hand-written update cannot store something the frame would silently ignore.
--
-- Nothing writes these columns yet, but a hand-edited row must not block the
-- constraint. A value that fails the shape is cleared: the frame already ignores it
-- (widget.js validates before it touches a style), so clearing changes nothing a
-- visitor could see.
update accounts set brand_primary = null
where brand_primary is not null and brand_primary !~ '^#[0-9a-fA-F]{6}$';

update accounts set brand_accent = null
where brand_accent is not null and brand_accent !~ '^#[0-9a-fA-F]{6}$';

alter table accounts
  add constraint accounts_brand_primary_shape
  check (brand_primary is null or brand_primary ~ '^#[0-9a-fA-F]{6}$'),
  add constraint accounts_brand_accent_shape
  check (brand_accent is null or brand_accent ~ '^#[0-9a-fA-F]{6}$');
