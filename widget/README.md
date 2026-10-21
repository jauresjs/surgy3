# Treatment preview widget

An embeddable version of the studio for a clinic's own site. One `<script>` tag
creates an iframe served from Hebelie's host; everything inside it is branded and
priced (in the future, billed) per tenant.

```
widget/
  embed.js      the loader a clinic pastes
  index.html    the frame document
  widget.css    frame styles, scoped to .h-app
  widget.js     frame app: config, treatments, photo, generate, lead
  demo.html     a stand-in host page for testing
```

## Install

```html
<div id="treatment-preview"></div>
<script src="https://<hebelie-host>/widget/embed.js"
        data-hebelie-key="pk_live_xxxxxxxxxxxxxxxx"
        data-hebelie-mode="inline"
        data-hebelie-target="#treatment-preview"
        defer></script>
```

| attribute | default | meaning |
| --- | --- | --- |
| `data-hebelie-key` | required | The tenant's public widget key (`widget_keys.public_key`). |
| `data-hebelie-mode` | `inline` | `inline` sits in the page flow; `floating` adds a launcher button and a panel that loads on first click. |
| `data-hebelie-target` | after the script | CSS selector for where an inline widget mounts. |
| `data-hebelie-label` | `Preview a treatment` | Launcher text in floating mode. |

`embed.js` derives the frame URL from its own `src`, so the same file works on
localhost, GitHub Pages, and a custom domain with no configuration.

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

`window.HebelieWidget` exposes `open()`, `close()`, `key`, `mode` and `frame()`
so a floating widget can be opened from a page CTA.

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
- The parent page never exposes its JavaScript to the frame, and the frame only
  trusts messages from its own `parent`.
- A browser-side proof (a per-tenant CSP `frame-ancestors`, or a token minted for
  an origin the server can independently confirm) needs the frame served by an
  edge function instead of static hosting. That is the next hardening step, along
  with a public logo bucket and an admin UI for keys and domain claiming.

## Getting a key

```sql
insert into widget_keys (account_id, public_key, label)
select id, 'pk_live_' || replace(gen_random_uuid()::text, '-', ''), 'Clinic site'
from accounts where slug = 'hebelie'
returning public_key;
```

Revoke with `update widget_keys set revoked_at = now() where public_key = '…'`.
A revoked key stops resolving within a minute (the tenant cache TTL).

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
