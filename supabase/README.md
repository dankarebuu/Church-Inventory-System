# Supabase Two-Phase Migration & Netlify Cutover Runbook

This runbook upgrades the live Supabase project (`gcplffcftuhjthtcnjjc`) for the React workspace **without taking down** the existing vanilla site at `wingmacc-inventory.netlify.app` while you build and test locally.

> **Never commit real credentials, service-role keys, or personal admin emails** into SQL files or Git. Always edit `<YOUR_ADMIN_EMAIL>` directly inside the Supabase SQL Editor when running Phase 2.

---

## Execution Order Overview

1. **Phase 1 (`001_phase1_extend_schema.sql`)** — Non-breaking schema extension & backfill while the vanilla app stays live.
2. **Audit Legacy `remarks` & `owner` Rows** — Review the trailing diagnostic query output from Phase 1.
3. **Local Testing** — Run the Vite React app against `.env.local` and verify Guest, Member, and Admin workflows.
4. **Netlify Environment Variables & Auth Redirects** — Configure `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and Supabase password-recovery URLs.
5. **Phase 2 (`002_phase2_rls_cutover.sql`)** — Replace `<YOUR_ADMIN_EMAIL>` in the SQL Editor and apply strict 3-tier RLS lockdown.
6. **Build & Deploy `dist/` Zip to Netlify** — Run `npm run build`, zip the contents of `dist/`, and upload to Netlify.

---

## Step 1: Run Phase 1 Migration (Safe While Vanilla Is Live)

1. Open the **Supabase Dashboard** for project `gcplffcftuhjthtcnjjc` -> **SQL Editor**.
2. Copy the entire contents of [001_phase1_extend_schema.sql](migrations/001_phase1_extend_schema.sql) and run it.
3. Confirm it succeeds without errors. Check the **Messages / Notices** tab for any `Skipping legacy loan backfill...` notices (e.g., soft-deleted items or `qty = 0` rows that had a `borrower` string).
4. **Review the trailing diagnostic `SELECT` result**:
   - It lists rows whose `borrower` is blank while `remarks` or `owner` match `\m(lent|borrow|loan)`.
   - Before running Phase 2, move any personal borrower names/notes out of `remarks`/`owner` into `public.loans` and clean `remarks` so Guests will not see borrower details in `inventory_public`.
5. Smoke-check `wingmacc-inventory.netlify.app` in your browser to confirm the live vanilla site still loads, edits, and logs history normally.

---

## Step 2: Test the New React App Locally

1. Create `.env.local` (gitignored) from `.env.example` with your project credentials:
   ```env
   VITE_SUPABASE_URL=https://gcplffcftuhjthtcnjjc.supabase.co
   VITE_SUPABASE_ANON_KEY=<your-anon-key>
   ```
2. Ensure your own user account has `'admin'` role for local Admin testing if desired by running **only** this statement in the Supabase SQL Editor (without running the rest of Phase 2 yet):
   ```sql
   UPDATE public.profiles
      SET role = 'admin'
    WHERE lower(email) = lower('<YOUR_ADMIN_EMAIL>');
   ```
3. Run automated verification and start the local dev server:
   ```bash
   npx vitest run
   npx tsc --noEmit
   npm run dev
   ```
4. Verify locally:
   - **Guest mode:** Opens `Dashboard`, `Inventory`, `Categories & Locations`, and `Sunday Checklist` (Print/PDF only); shows anonymous `On Loan` / availability counts without borrower names or Activity Log.
   - **Member mode:** Quick check-off (`OK` / `Fix` / `Lost`) via `member_check_item`, live Sunday Check-Off progress sync, and Loans check-out / check-in.
   - **Admin mode:** Full Item CRUD (including `qty = 0` and up to 4 `gear-photos`), Category/Subcategory/Location CRUD, CSV/JSON import & export, Activity Log Undo/Restore, and Team Roles view (role updates via UI activate after Phase 2 grants `UPDATE (role)` to admins; promote test admins in SQL Editor during Phase 1).
   - **Theme & Recovery:** Light/Dark toggle (`wingmacc_theme`) and password recovery flow (`/reset-password`).

---

## Step 3: Configure Netlify & Supabase Auth URLs

1. In **Netlify** -> Site configuration -> **Environment variables**, set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
2. In **Supabase Dashboard** -> **Authentication -> URL Configuration**, confirm:
   - **Site URL:** `https://wingmacc-inventory.netlify.app`
   - **Redirect URLs** include `https://wingmacc-inventory.netlify.app/reset-password` (and `http://localhost:5173/reset-password` for local dev).

---

## Step 4: Run Phase 2 Cutover & Upload Netlify `dist/` Zip

Run Phase 2 **immediately before** uploading the new Netlify build (once ready to retire the vanilla site):

1. Open the **Supabase SQL Editor** and paste [002_phase2_rls_cutover.sql](migrations/002_phase2_rls_cutover.sql).
2. Replace `<YOUR_ADMIN_EMAIL>` in the `UPDATE public.profiles` statement with your actual Supabase Auth login email.
   - **Safety guard:** If zero `'admin'` rows exist in `public.profiles`, the script raises an exception and aborts before locking down any tables.
   - **Incremental backfill:** The script re-runs the idempotent `loans` backfill to capture any loans logged on the vanilla app between Phase 1 and cutover.
3. Run the script in the SQL Editor.
4. In **Supabase Dashboard -> Storage -> Policies**, inspect `storage.objects` and verify no legacy permissive `INSERT`/`UPDATE`/`DELETE` policy lacking a `bucket_id = 'gear-photos'` guard remains alongside the new `gear_photos_*` policies.
5. Build and package the Vite app locally:
   ```bash
   npm run build
   ```
   Verify `dist/index.html`, `dist/_redirects`, and `dist/images/logo.svg` exist, then zip the **contents** of `dist/` (so `index.html` and `_redirects` sit at the root of the `.zip`, not inside a nested `dist/` folder).
6. Upload the zip to `wingmacc-inventory.netlify.app` via **Netlify -> Deploys -> Drag & drop**.

---

## Step 5: Post-Cutover Verification

1. Open `https://wingmacc-inventory.netlify.app` in an **Incognito / Guest** browser window with DevTools **Network** tab open:
   - Confirm requests hit `inventory_public`, `categories`, and `locations` only.
   - Confirm direct `anon` reads against `inventory`, `loans`, `history_log`, or `profiles` are rejected (`401`/`403` / permission denied) and never expose `"checkedBy"`, `borrower`, or `user_email`.
2. Refresh deep SPA routes directly (`/inventory`, `/loans`, `/checklist`, `/reset-password`) to confirm `dist/_redirects` serves `index.html` with `200`.
3. Log in as a **Member** and confirm `Sunday Checklist` check-offs succeed while direct item deletion or role edits are blocked.
4. Log in as **Admin** and confirm Team Roles blocks demoting the last remaining `'admin'`.

---

## Rollback Notes

- **After Phase 1 only:** Zero rollback needed — Phase 1 is purely additive and leaves the vanilla app completely intact.
- **After Phase 2 cutover:** The original 4-file vanilla app is preserved at Git tag `legacy-vanilla`. If you ever need to roll back to `legacy-vanilla`, you would re-deploy the `legacy-vanilla` commit to Netlify and temporarily re-grant `anon` `SELECT`/write policies on `inventory`, `history_log`, and `gear-photos` (not recommended once Guest privacy is active).
