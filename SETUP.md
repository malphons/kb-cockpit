# kb-cockpit — one-time setup

Ordered steps to make the cockpit live. Most are outside the editor (GitHub +
Supabase dashboards). The site code is already built; the anon key is already in
`config.js`. Substitute your values where noted.

> **The lock recap:** GitHub Pages is public, so the gate is **Supabase Auth +
> owner row-level security**, not Pages. The shell/JS/anon key are public by
> design and carry no secrets. The Anthropic key lives only in the Edge Function
> secret; the service_role key only in the local sync `.env`.

## A. Publish the site
1. The repo `malphons/kb-cockpit` is created and pushed (public). In GitHub →
   **Settings → Pages**, set Source = "Deploy from a branch", branch = `main`,
   folder = `/ (root)`. Confirm `https://malphons.github.io/kb-cockpit/` loads
   the **Sign in** screen.
2. In a fresh clone, re-arm the commit hook once: `git config core.hooksPath .githooks`.

## B. GitHub OAuth app (the sign-in provider)
3. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**:
   - Application name: `kb-cockpit`
   - Homepage URL: `https://malphons.github.io/kb-cockpit/`
   - **Authorization callback URL:** `https://vthwfufbcntvrjijhckj.supabase.co/auth/v1/callback`
     (this is Supabase's callback — GitHub talks to Supabase, which then returns to Pages)
   - Create, copy the **Client ID**, generate a **Client Secret**.

## C. Supabase Auth config
4. Supabase dashboard → **Authentication → Providers → GitHub**: enable, paste
   the Client ID + Secret, save.
5. **Authentication → URL Configuration:**
   - Site URL: `https://malphons.github.io/kb-cockpit/`
   - Redirect allow-list: add `https://malphons.github.io/kb-cockpit/` **and**
     `http://localhost:8778/` (for local preview).

## D. Database migrations
6. Supabase → **SQL editor** → run these migrations from the KB repo's
   `exoplanets/db/migrations/`, in order (each only ADDS objects — verify the
   existing `xo_*` policies are unchanged afterward):
   1. `kb_cockpit_schema.sql` — kb_pages, kb_bib, xo_ref_notes, RLS
   2. `kb_bib_abstract.sql` — abstract column on kb_bib
   3. `kb_bib_priority_tags.sql` — reading_priority + editable tags
   4. `kb_pdfs_storage.sql` — private `kb-pdfs` bucket + pdf_object
   5. `kb_archive_storage.sql` — private `kb-archive` bucket + kb_archive table
   6. `kb_archive_annotations.sql` — archive tags/priority + the unified
      `kb_library` view the Bibliography page reads (curated + archive)
   7. `kb_promote.sql` — promote_to_curated() RPC + pdf_bucket/promoted_to
      (the Bibliography "Promote to curated" button)

   For the archive's larger PDFs, also raise the project upload limit:
   **Project Settings → Storage → "Upload file size limit" → 100 MB**.

## E. Make yourself the owner
7. Open the deployed site and **sign in once** with GitHub (this creates your
   `auth.users` row). You'll see "Access denied" — that's expected until the
   next step.
8. SQL editor: find your id and add the allowlist row:
   ```sql
   select id, email from auth.users;            -- copy your uuid
   insert into kb_allowed_users (user_id, email, note)
   values ('<your-uuid>', 'ma4381@columbia.edu', 'owner');
   ```
   Reload the site — you're in.

## F. Chat function
9. From the KB repo's `exoplanets/` directory (where `supabase/` lives), with the
   Supabase CLI linked to project `vthwfufbcntvrjijhckj`:
   ```sh
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase functions deploy kb-chat
   ```
   (If the CLI isn't linked yet: `supabase link --project-ref vthwfufbcntvrjijhckj`.)

## G. Load content
10. From `exoplanets/db/sync/` with a local `.env` (SUPABASE_URL +
    SUPABASE_SERVICE_ROLE_KEY):
    ```sh
    pip install -r requirements.txt
    python sync_kb.py            # mirror wiki + manuscripts -> kb_pages
    python generate_bib_seed.py  # litreview xlsx -> seed_bib.sql
    #   paste seed_bib.sql into the Supabase SQL editor (loads kb_bib + xo_sources)
    python verify_kb_sync.py     # sanity check
    ```
11. Reload the cockpit: the navigator shows the tree, chat answers with citations,
    and the bibliography lists references with editable notes.

## Keeping it fresh
- After editing the KB, re-run `python sync_kb.py` (cheap; the navigator shows
  "synced N ago").
- To re-seed the bibliography after tracker changes, re-run `generate_bib_seed.py`
  and re-apply `seed_bib.sql`.

## Phase-2 (semantic chat)
Full-text retrieval is the v1 default. To upgrade to embeddings/semantic search,
follow the commented block at the bottom of `kb_cockpit_schema.sql` and the note
in `db/sync/README.md`.
