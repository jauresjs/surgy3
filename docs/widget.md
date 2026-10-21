# Treatment preview widget

An embeddable version of the studio for a clinic's own site. One `<script>` tag
creates an iframe served from Hebelie's host; everything inside it is branded and
priced (in the future, billed) per tenant.

This page is documentation, not part of the embed: it lives in `docs/` rather
than `widget/` because the Pages workflow publishes the `widget` folder whole.

```
widget/
  embed.js      the loader a clinic pastes (also published as /widget/v1/embed.js)
  index.html    the frame document
  widget.css    frame styles, scoped to .h-app
  widget.js     frame app: config, treatments, photo, generate, lead
  demo.html     a stand-in host page for testing
```

## Install

Two forms, one file. The placeholder form is the one a clinic should paste: the
div is the slot, so the widget appears wherever the div is and nothing in the
snippet has to be kept in sync with the page.

```html
<!-- the slot: move the div wherever the widget should appear -->
<div data-hebelie-widget="pk_live_xxxxxxxxxxxxxxxx"></div>
<script src="https://<hebelie-host>/widget/v1/embed.js" defer></script>
```

```html
<!-- one tag, mounted beside itself or at data-hebelie-target -->
<script src="https://<hebelie-host>/widget/v1/embed.js"
        data-hebelie-key="pk_live_xxxxxxxxxxxxxxxx"
        data-hebelie-mode="inline"
        data-hebelie-target="#treatment-preview"
        defer></script>
```

| attribute | default | meaning |
| --- | --- | --- |
| `data-hebelie-widget` | required on a slot | The tenant's public widget key (`widget_keys.public_key`). |
| `data-hebelie-key` | required on a tag | The same key, for the one-tag form. |
| `data-hebelie-mode` | `inline` | `inline` sits in the page flow; `floating` adds a launcher button and a panel that loads on first click. |
| `data-hebelie-target` | after the script | CSS selector for where the tag-form inline widget mounts. A slot mounts inside itself, so this is ignored there. |
| `data-hebelie-theme` | `light` | `light`, `dark` or `auto` (follows the visitor's `prefers-color-scheme`) for the launcher and panel chrome. The frame stays branded by the tenant. |
| `data-hebelie-width` | `560px` | A single CSS length (`100%`, `720px`, `42rem`) for an inline widget's max width. |
| `data-hebelie-launcher-position` | `bottom-right` | `bottom-right` or `bottom-left`, floating mode only. |
| `data-hebelie-label` | `Preview a treatment` | Launcher text in floating mode. |

A slot's own attributes win over the script tag's, so one tag can carry the
defaults for every slot on a page. A slot that appears after the loader ran
(a page builder, a tab that renders late) is picked up as it is inserted;
`window.HebelieWidget.scan()` does the same scan on demand.

`embed.js` derives the frame URL from its own `src`, so the same file works on
localhost, GitHub Pages, and a custom domain with no configuration.
`/widget/v1/embed.js` is the versioned path a clinic should paste: the Pages
workflow publishes it from this same `widget/embed.js`, and the day a breaking
change is needed v1 is frozen as a real file and v2 ships beside it. The desk's
snippet names that same v1 URL, and the **Div slot** form is the default there,
with **Script tag** kept for a site that can only take a script. The desk's own
preview still loads the unversioned `widget/embed.js`, because a desk opened
under a plain `python -m http.server` has no `/widget/v1/` folder to load, and
the preview should not be the thing that breaks when a version freezes.

## Events

The loader re-emits frame events on the host document. Read `event.detail`, never
the frame's DOM.

| event | detail | when |
| --- | --- | --- |
| `hebelie:ready` | `{ tenant }` | Config loaded, treatments rendered. |
| `hebelie:preview` | `{ treatmentIds }` | A new preview was generated. |
| `hebelie:lead` | `{ treatmentIds }` | Contact details were accepted. |
| `hebelie:error` | `{ status, message }` | The frame could not load its key or config. |
| `hebelie:open` / `hebelie:close` | `{ key }` | Floating panel opened or closed. |

```js
document.addEventListener("hebelie:lead", function (event) {
  // e.g. push a conversion to the clinic's analytics
  console.log("lead", event.detail.treatmentIds);
});
```

`window.HebelieWidget` exposes `open()`, `close()`, `frame()`, `key`, `mode`,
`scan()` — so a floating widget can be opened from a page CTA — plus `instances`,
one entry per mounted widget for a page that holds more than one.

## What the tenant controls

All of it comes from the account row and `/widget/config`; nothing is compiled in.

- `accounts.brand_primary`, `brand_accent` — hex colours, validated in the frame
  before they reach a style declaration.
- `accounts.name`, `tagline` — the brand line above the treatments.
- `accounts.logo_path` — an absolute URL, or a path in the private `previews`
  bucket that the API exchanges for a one-hour signed URL.
- `accounts.booking_url` — the button shown on the thank-you screen.
- `account_treatments` — the treatments this clinic sells. An empty set means
  the full catalog, so a brand-new trial tenant is not empty on day one.

## Security model

- The key is public by design; it identifies a tenant, it does not authenticate one.
  `resolveTenant` refuses revoked keys (`widget_keys.revoked_at`), and a revoked key
  stops working within a minute.
- The frame reports the page framing it through `x-parent-origin`, filled from
  `postMessage`'s `event.origin`. Inside a real embed that value is the parent's
  true origin; the API checks it against `domains` rows with a non-null
  `verified_at`, and only when the tenant has at least one verified origin.
- **This is not a security boundary.** A caller that talks to the API directly
  can send any `x-parent-origin` it wants. The allow-list prevents a snippet from
  being pasted on the wrong site; it does not stop a determined abuser. What
  actually limits damage is a public key that can be revoked, the per-tenant
  `HOUR_LIMIT`, and `account_treatments` (`assertTreatmentsOffered`) keeping a
  clinic from previewing something it does not sell.
- A tenant with no verified origin is unrestricted, which keeps a fresh install
  working before DNS is claimed.
- Our own pages are exempt. `isFirstParty` in `tenancy.ts` lets a request through
  when the page framing it is either the host the function is served from or one
  listed in the `WIDGET_FIRST_PARTY_ORIGINS` secret (comma-separated). That is
  what keeps the desk preview working once a clinic has verified a domain: the
  preview frames the widget from the desk's own origin, so without the exemption
  the first claimed domain would refuse our own product. The same list covers the
  widget page itself and any hosted preview page on our host. A clinic cannot add
  one of our origins to the list — `domains` belongs to the tenant, the list does
  not.
- The parent page never exposes its JavaScript to the frame, and the frame only
  trusts messages from its own `parent`.
- A browser-side proof (a per-tenant CSP `frame-ancestors`, or a token minted for
  an origin the server can independently confirm) needs the frame served by an
  edge function instead of static hosting. That is the next hardening step, along
  with a public logo bucket and an admin UI for domain claiming.

## Getting a key

Every account already has one. Sign in to the desk at `/admin/`, open the
**Widget** tab, and the snippet is waiting: the key is created at signup
(`provisionDefaultKey` in `createClinic`), backfilled for accounts that predate
that (migration `20261021130000_widget_key_autoprovision.sql`), and provisioned on
the first desk visit if a signup's key insert failed. Nothing has to be generated
by hand before a clinic can embed the widget.

That tab also runs a live preview through this exact `embed.js`, offers a Copy
snippet button, and lists every key with a Revoke button. An account may hold up
to 10 active keys (`MAX_ACTIVE_KEYS` in `keys.ts`); the desk refuses an 11th with
a 409. A key is a public identifier, not a secret: it is visible in the clinic's
own page source, and revocation is what limits abuse.

The **Install** tab takes that same snippet and puts it where someone can act on
it: a platform picker (WordPress, Shopify, Squarespace, Wix, custom HTML), the
exact file or screen to paste into, and the snippet already in the form that
platform will keep. Both tabs read one key list, so they cannot disagree.

Its status line answers "is it live yet?" from `widget_keys.last_parent_origin`
and `last_parent_at` (migration `20261021140000_widget_key_origin.sql`), never
from `last_used_at`. `last_used_at` stamps on every `resolveTenant` call,
including the desk's own preview, so it cannot tell a key that never left the
desk from one serving a clinic's site. `tenancy.ts` writes the parent origin only
after `assertOriginAllowed` has accepted the page, and only when that page is not
first party, so "not seen on a site yet" means what it says: a site the clinic
never claimed gets a 403 and leaves the key untouched, rather than being named as
the place the widget is live. Deploy that migration before the function: a
function running ahead of it falls back to `last_used_at` alone instead of
failing the whole update.

An operator can still create one directly, for a key that bypasses the desk:

```sql
insert into widget_keys (account_id, public_key, label)
select id, 'pk_live_' || replace(gen_random_uuid()::text, '-', ''), 'Clinic site'
from accounts where slug = 'hebelie'
returning public_key;
```

Revoke with `update widget_keys set revoked_at = now() where public_key = '…'`.
Revoking through the desk also drops the cached tenant, so the key is refused on
the very next request; a key revoked in SQL stops resolving within a minute (the
tenant cache TTL).

## Testing locally

```bash
python -m http.server 8787
# then open http://localhost:8787/widget/demo.html?key=pk_live_…&mode=inline
```

`localhost` is not in any tenant's verified origins, so the origin check passes as
"not yet claimed". To exercise a rejection, add a verified origin and reload.

## Deploying the API

```bash
supabase functions deploy hebelie-api --project-ref qqrcxbmbulfsvgbqjngz --no-verify-jwt
```

The `--no-verify-jwt` flag is required: the widget and the site call the function
without a Supabase session, and a plain deploy silently re-enables JWT
verification, which turns every request into a 401.

`WIDGET_FIRST_PARTY_ORIGINS` is the list of our own page origins, comma-separated
(`https://jauresjs.github.io` for Pages, plus any custom domain). A tenant with no
verified origin is unrestricted, so a missing value is invisible until the first
clinic claims a domain — set it before that happens:

```bash
supabase secrets set WIDGET_FIRST_PARTY_ORIGINS=https://jauresjs.github.io \
  --project-ref qqrcxbmbulfsvgbqjngz
```
