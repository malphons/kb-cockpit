# kb-cockpit

A private, authenticated cockpit over the **PhD_Exoplanets** knowledge base — an
Obsidian/IDE/Copilot-like view to navigate the KB, an AI chat assistant grounded
in it, and a searchable bibliography with live editable notes per reference.

Dependency-free static site (no build step) served from GitHub Pages, gated by
**Supabase Auth (GitHub OAuth) + row-level security**. Companion to the public
[`xoplanet-explorer`](https://github.com/malphons/xoplanet-explorer); shares the
same Supabase project but reads **private** tables that require an owner session.

## The lock (important)

GitHub Pages on a personal account is **always public** — you cannot gate it at
the Pages layer. So the page shell, JS, and `config.js` are public *by design*
and contain **no secrets and no private content**. Access is enforced by:

1. **Supabase Auth** — sign in with GitHub.
2. **Owner row-level security** — every private table (`kb_pages`, `xo_ref_notes`,
   `kb_chat_log`) only returns rows when your `auth.uid()` is in `kb_allowed_users`.
   Anyone else who signs in sees nothing and gets a 403 from the chat function.

The anon key in `config.js` is public-read safe; the **Anthropic key** lives only
in the `kb-chat` Edge Function secret; the **service_role key** lives only in the
local sync `.env`. Neither is ever shipped to the browser.

## Pages

- `index.html` — login gate + landing (KB stats once signed in as owner).
- `navigator.html` — file-tree sidebar · rendered markdown · backlinks + graph.
- `chat.html` — RAG chat over the KB with citations and a model selector.
- `bibliography.html` — searchable reference table with live per-reference notes.

## How content gets here

The KB markdown is **mirrored** into Supabase (`kb_pages`) by a re-runnable sync
script in the KB repo (`exoplanets/db/sync/sync_kb.py`); the bibliography is seeded
into `xo_sources` from the LitReview tracker. The cockpit reads those tables via
authenticated REST. Re-run the sync after editing the KB — the navigator shows
"synced N ago".

## No-build note

There is no bundler. Two libraries are vendored under `assets/vendor/` as the
only exceptions (security/markdown correctness): `marked.min.js` (markdown) and
`supabase.min.js` (the `@supabase/supabase-js` UMD bundle — handles OAuth/PKCE
and session refresh). Everything else is hand-written plain JS.

## Setup

See **[SETUP.md](SETUP.md)** for the ordered one-time setup (GitHub OAuth app,
Supabase Auth config, SQL migration, allowlist row, Edge Function secret + deploy,
and running the sync). After setup: paste the anon key into `config.js` (already
filled for this project), enable Pages, and sign in.

## Local preview

Serve the folder at an origin allow-listed in Supabase Auth (e.g.
`python -m http.server 8000`), then open `http://localhost:8000/`. Until you sign
in as the owner, only the sign-in screen renders.
