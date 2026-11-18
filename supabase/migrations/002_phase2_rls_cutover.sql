-- ============================================================================
-- WINGMACC Band Inventory — Phase 2 Migration (Strict 3-Tier RLS Cutover)
-- ============================================================================
-- Run this script AT NETLIFY CUTOVER after:
--   1. 001_phase1_extend_schema.sql has been executed.
--   2. Legacy remarks/owner audit rows have been reviewed and cleaned.
--   3. <YOUR_ADMIN_EMAIL> below has been replaced with your real login email
--      (do NOT commit your real email back to Git).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Bootstrap Admin profile & abort safely if zero admins exist
-- ----------------------------------------------------------------------------
-- IMPORTANT: Replace <YOUR_ADMIN_EMAIL> with your Supabase Auth email before running!
UPDATE public.profiles
   SET role = 'admin'
 WHERE lower(email) = lower('<YOUR_ADMIN_EMAIL>');

DO $$
DECLARE
  v_admin_count int;
BEGIN
  SELECT count(*)
    INTO v_admin_count
    FROM public.profiles
   WHERE role = 'admin';

  IF v_admin_count = 0 THEN
    RAISE EXCEPTION
      'Phase 2 cutover aborted: zero admin profiles exist. Replace <YOUR_ADMIN_EMAIL> with an existing authenticated user email before running 002_phase2_rls_cutover.sql.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Re-run idempotent loans backfill (captures vanilla loans since Phase 1)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_row record;
  v_due_date date;
  v_notes text;
  v_raw_return text;
BEGIN
  FOR v_row IN
    SELECT
      i.id,
      btrim(i.borrower) AS borrower_name,
      i."returnDate" AS return_date_raw,
      nullif(btrim(coalesce(i."checkedBy", '')), '') AS checked_by,
      coalesce(i.qty, 0) AS qty,
      i.deleted_at
    FROM public.inventory i
    WHERE coalesce(btrim(i.borrower), '') <> ''
  LOOP
    IF v_row.deleted_at IS NOT NULL THEN
      RAISE NOTICE 'Skipping legacy loan backfill for soft-deleted item % (borrower: %)', v_row.id, v_row.borrower_name;
      CONTINUE;
    END IF;

    IF v_row.qty < 1 THEN
      RAISE NOTICE 'Skipping legacy loan backfill for item % with qty = % (borrower: %)', v_row.id, v_row.qty, v_row.borrower_name;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.loans l
      WHERE l.item_id = v_row.id
        AND (
          l.returned_at IS NULL
          OR lower(btrim(l.borrower_name)) = lower(v_row.borrower_name)
        )
    ) THEN
      CONTINUE;
    END IF;

    v_due_date := NULL;
    v_notes := 'Migrated from legacy borrower field';
    v_raw_return := nullif(btrim(coalesce(v_row.return_date_raw::text, '')), '');

    IF v_raw_return IS NOT NULL THEN
      BEGIN
        v_due_date := v_raw_return::date;
      EXCEPTION WHEN others THEN
        v_due_date := NULL;
        v_notes := v_notes || ' (unparsed legacy "returnDate": ' || v_raw_return || ')';
      END;
    END IF;

    INSERT INTO public.loans (
      item_id,
      borrower_name,
      qty_loaned,
      due_date,
      checked_out_by,
      notes
    )
    VALUES (
      v_row.id,
      v_row.borrower_name,
      1,
      v_due_date,
      coalesce(v_row.checked_by, 'Legacy Migration'),
      v_notes
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Guest privacy lockdown & table/view/function grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.inventory FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.loans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.history_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.categories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.locations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.inventory_public FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.inventory_public TO anon, authenticated;
GRANT SELECT ON public.categories, public.locations TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.history_log TO authenticated;
GRANT SELECT, UPDATE (role) ON public.profiles TO authenticated;

GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon, authenticated;
REVOKE ALL ON FUNCTION public.member_check_item(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_check_item(text, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Helper & trigger preventing the last remaining admin from self-demotion
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_other_admin(p_excluded_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.role = 'admin'
      AND p.id IS DISTINCT FROM p_excluded_id
  );
$$;

REVOKE ALL ON FUNCTION public.has_other_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_other_admin(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.lock_profile_role_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Serialize role/delete mutations across concurrent transactions so
  -- AFTER STATEMENT checks observe committed changes from peer sessions.
  PERFORM pg_advisory_xact_lock(hashtext('public.profiles'), hashtext('last_admin'));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_remaining_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Cannot demote or remove the last remaining admin'
      USING ERRCODE = '42501';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_last_admin_removal ON public.profiles;
DROP FUNCTION IF EXISTS public.prevent_last_admin_removal();

DROP TRIGGER IF EXISTS trg_lock_profile_role_mutations ON public.profiles;
CREATE TRIGGER trg_lock_profile_role_mutations
  BEFORE UPDATE OF role OR DELETE ON public.profiles
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.lock_profile_role_mutations();

DROP TRIGGER IF EXISTS trg_ensure_remaining_admin ON public.profiles;
CREATE TRIGGER trg_ensure_remaining_admin
  AFTER UPDATE OF role OR DELETE ON public.profiles
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.ensure_remaining_admin();

-- ----------------------------------------------------------------------------
-- 5. Drop legacy/permissive policies & enable strict RLS across public tables
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_pol record;
BEGIN
  FOR v_pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('inventory', 'categories', 'locations', 'loans', 'history_log', 'profiles')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', v_pol.policyname, v_pol.schemaname, v_pol.tablename);
  END LOOP;
END $$;

-- 5a. public.inventory
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_select_member_or_admin"
  ON public.inventory
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR (public.current_user_role() = 'member' AND deleted_at IS NULL)
  );

CREATE POLICY "inventory_insert_admin"
  ON public.inventory
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "inventory_update_admin"
  ON public.inventory
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "inventory_delete_admin"
  ON public.inventory
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 'admin');

-- 5b. public.categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categories_select_all"
  ON public.categories
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "categories_insert_admin"
  ON public.categories
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "categories_update_admin"
  ON public.categories
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "categories_delete_admin"
  ON public.categories
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 'admin');

-- 5c. public.locations
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "locations_select_all"
  ON public.locations
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "locations_insert_admin"
  ON public.locations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "locations_update_admin"
  ON public.locations
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "locations_delete_admin"
  ON public.locations
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 'admin');

-- 5d. public.loans
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "loans_select_member_or_admin"
  ON public.loans
  FOR SELECT
  TO authenticated
  USING (public.current_user_role() IN ('member', 'admin'));

CREATE POLICY "loans_insert_member_or_admin"
  ON public.loans
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_role() IN ('member', 'admin'));

CREATE POLICY "loans_update_member_or_admin"
  ON public.loans
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() IN ('member', 'admin'))
  WITH CHECK (public.current_user_role() IN ('member', 'admin'));

CREATE POLICY "loans_delete_admin"
  ON public.loans
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 'admin');

-- 5e. public.history_log
ALTER TABLE public.history_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "history_log_select_member_or_admin"
  ON public.history_log
  FOR SELECT
  TO authenticated
  USING (public.current_user_role() IN ('member', 'admin'));

CREATE POLICY "history_log_insert_member_or_admin"
  ON public.history_log
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_role() IN ('member', 'admin'));

CREATE POLICY "history_log_update_admin"
  ON public.history_log
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- 5f. public.profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_self_or_admin"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR public.current_user_role() = 'admin'
  );

CREATE POLICY "profiles_update_admin_guard_last_admin"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND (
      role = 'admin'
      OR public.has_other_admin(id)
    )
  );

-- ----------------------------------------------------------------------------
-- 6. Storage RLS lockdown for the gear-photos bucket
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_pol record;
BEGIN
  FOR v_pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        coalesce(qual, '') ~* 'gear-photos'
        OR coalesce(with_check, '') ~* 'gear-photos'
        OR policyname LIKE 'gear\_photos\_%' ESCAPE '\'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', v_pol.policyname, v_pol.schemaname, v_pol.tablename);
  END LOOP;
END $$;

CREATE POLICY "gear_photos_public_select"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'gear-photos');

CREATE POLICY "gear_photos_admin_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'gear-photos'
    AND public.current_user_role() = 'admin'
  );

CREATE POLICY "gear_photos_admin_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'gear-photos'
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    bucket_id = 'gear-photos'
    AND public.current_user_role() = 'admin'
  );

CREATE POLICY "gear_photos_admin_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'gear-photos'
    AND public.current_user_role() = 'admin'
  );
