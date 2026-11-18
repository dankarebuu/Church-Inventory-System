-- ============================================================================
-- WINGMACC Band Inventory — Phase 1 Migration (Non-Breaking Schema Extension)
-- ============================================================================
-- Safe to run while the legacy vanilla site (wingmacc-inventory.netlify.app)
-- remains live:
--   - Does NOT revoke anon privileges on legacy tables (inventory, history_log).
--   - Does NOT tighten RLS on inventory, history_log, or storage.objects yet.
--   - All DDL and seed/backfill steps are idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Profiles table + auth.users trigger + backfill + role helper
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  first_name text,
  last_name text,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text;
  v_first text;
  v_last text;
BEGIN
  v_full_name := nullif(btrim(coalesce(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'username',
    ''
  )), '');

  v_first := nullif(btrim(coalesce(
    NEW.raw_user_meta_data->>'first_name',
    CASE
      WHEN v_full_name IS NOT NULL THEN split_part(v_full_name, ' ', 1)
      ELSE ''
    END
  )), '');

  v_last := nullif(btrim(coalesce(
    NEW.raw_user_meta_data->>'last_name',
    CASE
      WHEN v_full_name IS NOT NULL AND position(' ' IN v_full_name) > 0
      THEN substring(v_full_name FROM position(' ' IN v_full_name) + 1)
      ELSE ''
    END
  )), '');

  INSERT INTO public.profiles (id, email, first_name, last_name, role)
  VALUES (
    NEW.id,
    coalesce(NEW.email, ''),
    v_first,
    v_last,
    'member'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_user_profile_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text;
  v_first text;
  v_last text;
BEGIN
  v_full_name := nullif(btrim(coalesce(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'username',
    ''
  )), '');

  v_first := nullif(btrim(coalesce(
    NEW.raw_user_meta_data->>'first_name',
    CASE
      WHEN v_full_name IS NOT NULL THEN split_part(v_full_name, ' ', 1)
      ELSE ''
    END
  )), '');

  v_last := nullif(btrim(coalesce(
    NEW.raw_user_meta_data->>'last_name',
    CASE
      WHEN v_full_name IS NOT NULL AND position(' ' IN v_full_name) > 0
      THEN substring(v_full_name FROM position(' ' IN v_full_name) + 1)
      ELSE ''
    END
  )), '');

  UPDATE public.profiles
     SET email = coalesce(NEW.email, email),
         first_name = coalesce(v_first, first_name),
         last_name = coalesce(v_last, last_name)
   WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF email, raw_user_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_user_profile_sync();

-- Backfill profiles for any existing auth.users rows.
INSERT INTO public.profiles (id, email, first_name, last_name, role)
SELECT
  u.id,
  coalesce(u.email, ''),
  nullif(btrim(coalesce(
    u.raw_user_meta_data->>'first_name',
    split_part(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'username', ''), ' ', 1)
  )), ''),
  nullif(btrim(coalesce(
    u.raw_user_meta_data->>'last_name',
    CASE
      WHEN nullif(btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'username', '')), '') IS NOT NULL
       AND position(' ' IN btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'username', ''))) > 0
      THEN substring(
        btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'username', ''))
        FROM position(' ' IN btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'username', ''))) + 1
      )
      ELSE ''
    END
  )), ''),
  'member'
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 'guest';
  END IF;

  SELECT p.role
    INTO v_role
    FROM public.profiles p
   WHERE p.id = v_uid;

  IF v_role IN ('admin', 'member') THEN
    RETURN v_role;
  END IF;

  -- Fallback if an authenticated session precedes trigger completion.
  RETURN 'member';
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Categories table (2-level hierarchy) + seed from legacy CATEGORY_COLORS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  parent_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  color text NOT NULL DEFAULT '#7a8290',
  icon text DEFAULT 'tag',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS DISTINCT FROM id)
);

CREATE UNIQUE INDEX IF NOT EXISTS categories_parent_name_uidx
  ON public.categories (
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );

INSERT INTO public.categories (name, parent_id, color, icon, sort_order)
VALUES
  ('Drums', NULL, '#d97740', 'drum', 10),
  ('Bass Rig', NULL, '#e8a33d', 'guitar', 20),
  ('Electric Guitar Rig', NULL, '#d3554a', 'zap', 30),
  ('Acoustic & Classical', NULL, '#5fa777', 'music', 40),
  ('Keyboard', NULL, '#4fa8a0', 'keyboard', 50),
  ('In-Ear Monitors', NULL, '#9575b0', 'headphones', 60),
  ('Spares & Shared', NULL, '#4e7fb0', 'cable', 70),
  ('Unassigned - Needs Review', NULL, '#8b92a0', 'help-circle', 80),
  ('Others', NULL, '#8b92a0', 'tag', 90)
ON CONFLICT DO NOTHING;

INSERT INTO public.categories (name, parent_id, color, icon, sort_order)
SELECT DISTINCT ON (lower(btrim(i.category)))
  btrim(i.category) AS name,
  NULL::uuid AS parent_id,
  '#7a8290' AS color,
  'tag' AS icon,
  100 AS sort_order
FROM public.inventory i
WHERE btrim(coalesce(i.category, '')) <> ''
ORDER BY lower(btrim(i.category)), btrim(i.category)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Locations table + seed from inventory.location (default 'Stage')
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS locations_name_lower_uidx
  ON public.locations (lower(name));

INSERT INTO public.locations (name, sort_order)
VALUES ('Stage', 10)
ON CONFLICT DO NOTHING;

INSERT INTO public.locations (name, sort_order)
SELECT DISTINCT ON (lower(btrim(i.location)))
  btrim(i.location) AS name,
  50 AS sort_order
FROM public.inventory i
WHERE btrim(coalesce(i.location, '')) <> ''
ORDER BY lower(btrim(i.location)), btrim(i.location)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. Additive columns on public.inventory + idempotent backfills + trigger
-- ----------------------------------------------------------------------------
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subcategory_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS inventory_category_id_idx ON public.inventory (category_id);
CREATE INDEX IF NOT EXISTS inventory_subcategory_id_idx ON public.inventory (subcategory_id);
CREATE INDEX IF NOT EXISTS inventory_location_id_idx ON public.inventory (location_id);

UPDATE public.inventory i
   SET category_id = c.id
  FROM public.categories c
 WHERE c.parent_id IS NULL
   AND i.category_id IS NULL
   AND btrim(coalesce(i.category, '')) <> ''
   AND lower(btrim(i.category)) = lower(c.name);

UPDATE public.inventory i
   SET location_id = l.id
  FROM public.locations l
 WHERE i.location_id IS NULL
   AND btrim(coalesce(i.location, '')) <> ''
   AND lower(btrim(i.location)) = lower(l.name);

UPDATE public.inventory
   SET updated_at = now()
 WHERE updated_at IS NULL;

-- Best-effort parse of legacy text "dateChecked" into checked_at (non-fatal).
DO $$
DECLARE
  v_row record;
  v_raw text;
  v_parsed timestamptz;
BEGIN
  FOR v_row IN
    SELECT id, "dateChecked"::text AS date_checked_raw
    FROM public.inventory
    WHERE checked_at IS NULL
      AND btrim(coalesce("dateChecked"::text, '')) NOT IN ('', '—', '-', 'N/A', 'n/a', 'TBD', 'tbd')
  LOOP
    v_raw := btrim(v_row.date_checked_raw);
    v_parsed := NULL;

    BEGIN
      v_parsed := v_raw::timestamptz;
    EXCEPTION WHEN others THEN
      v_parsed := NULL;
    END;

    IF v_parsed IS NULL THEN
      BEGIN
        v_parsed := to_timestamp(v_raw, 'Month DD, YYYY');
      EXCEPTION WHEN others THEN
        v_parsed := NULL;
      END;
    END IF;

    IF v_parsed IS NULL THEN
      BEGIN
        v_parsed := to_timestamp(v_raw, 'Mon DD, YYYY');
      EXCEPTION WHEN others THEN
        v_parsed := NULL;
      END;
    END IF;

    IF v_parsed IS NOT NULL THEN
      UPDATE public.inventory
         SET checked_at = v_parsed
       WHERE id = v_row.id
         AND checked_at IS NULL;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.touch_inventory_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_updated_at ON public.inventory;
CREATE TRIGGER trg_inventory_updated_at
  BEFORE UPDATE ON public.inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_inventory_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Defensive history_log.action CHECK constraint update
-- ----------------------------------------------------------------------------
-- Drops any pre-existing CHECK constraint on history_log.action so new
-- audit actions ('checked', 'restored', 'loan') succeed alongside legacy ones.
DO $$
DECLARE
  v_conname text;
  v_has_legacy_outliers boolean;
BEGIN
  IF to_regclass('public.history_log') IS NOT NULL THEN
    FOR v_conname IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = ANY (c.conkey)
      WHERE c.conrelid = 'public.history_log'::regclass
        AND c.contype = 'c'
        AND a.attname = 'action'
    LOOP
      EXECUTE format('ALTER TABLE public.history_log DROP CONSTRAINT IF EXISTS %I', v_conname);
    END LOOP;

    SELECT EXISTS (
      SELECT 1
      FROM public.history_log
      WHERE action IS NULL
         OR action NOT IN ('added', 'updated', 'checked', 'deleted', 'restored', 'import', 'loan')
    )
    INTO v_has_legacy_outliers;

    IF v_has_legacy_outliers THEN
      ALTER TABLE public.history_log
        ADD CONSTRAINT history_log_action_check
        CHECK (action IN ('added', 'updated', 'checked', 'deleted', 'restored', 'import', 'loan')) NOT VALID;
    ELSE
      ALTER TABLE public.history_log
        ADD CONSTRAINT history_log_action_check
        CHECK (action IN ('added', 'updated', 'checked', 'deleted', 'restored', 'import', 'loan'));
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. Loans table + capacity trigger + idempotent backfill from inventory.borrower
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id text NOT NULL REFERENCES public.inventory(id) ON DELETE CASCADE,
  borrower_name text NOT NULL CHECK (btrim(borrower_name) <> ''),
  borrower_contact text,
  qty_loaned int NOT NULL DEFAULT 1 CHECK (qty_loaned >= 1),
  checked_out_at timestamptz NOT NULL DEFAULT now(),
  due_date date,
  returned_at timestamptz,
  checked_out_by text,
  returned_by text,
  notes text
);

CREATE INDEX IF NOT EXISTS loans_item_id_idx ON public.loans (item_id);
CREATE INDEX IF NOT EXISTS loans_active_item_idx ON public.loans (item_id) WHERE returned_at IS NULL;

CREATE OR REPLACE FUNCTION public.check_loan_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_qty numeric;
  v_deleted_at text;
  v_active_loaned int;
BEGIN
  -- Returning a loan does not increase active units on loan.
  IF NEW.returned_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(qty, 0), deleted_at::text
    INTO v_item_qty, v_deleted_at
    FROM public.inventory
   WHERE id = NEW.item_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item % does not exist', NEW.item_id;
  END IF;

  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot loan soft-deleted inventory item %', NEW.item_id;
  END IF;

  SELECT coalesce(sum(qty_loaned), 0)::int
    INTO v_active_loaned
    FROM public.loans
   WHERE item_id = NEW.item_id
     AND returned_at IS NULL
     AND id IS DISTINCT FROM NEW.id;

  IF v_active_loaned + NEW.qty_loaned > v_item_qty THEN
    RAISE EXCEPTION 'Loan capacity exceeded for item %: requested %, already on loan %, total qty %',
      NEW.item_id, NEW.qty_loaned, v_active_loaned, v_item_qty;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_loan_capacity ON public.loans;
CREATE TRIGGER trg_check_loan_capacity
  BEFORE INSERT OR UPDATE OF item_id, qty_loaned, returned_at ON public.loans
  FOR EACH ROW
  EXECUTE FUNCTION public.check_loan_capacity();

-- Idempotent backfill from legacy inventory.borrower + "returnDate".
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
-- 7. Safe public view (inventory_public) — zero borrower or team-member PII
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.inventory_public
WITH (security_invoker = false) AS
SELECT
  i.id,
  i.category,
  i.category_id,
  i.subcategory_id,
  i.item,
  i.brand,
  i.qty,
  i.condition,
  i.owner,
  i.location,
  i.location_id,
  i.serial,
  i.description,
  i.image_filename,
  i.remarks,
  i."dateChecked",
  i.checked_at,
  coalesce(l.qty_on_loan, 0)::int AS qty_on_loan,
  greatest(coalesce(i.qty, 0)::int - coalesce(l.qty_on_loan, 0)::int, 0)::int AS available_qty
FROM public.inventory i
LEFT JOIN (
  SELECT
    item_id,
    sum(qty_loaned)::int AS qty_on_loan
  FROM public.loans
  WHERE returned_at IS NULL
  GROUP BY item_id
) l ON l.item_id = i.id
WHERE i.deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 8. Scoped member check-off RPC (public.member_check_item)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_check_item(
  p_item_id text,
  p_condition text,
  p_remarks text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_item public.inventory%ROWTYPE;
  v_updated public.inventory%ROWTYPE;
  v_email text;
  v_first_name text;
  v_last_name text;
  v_checked_by text;
  v_now timestamptz := now();
  v_date_checked text;
  v_action text;
  v_hist_id text;
BEGIN
  v_role := public.current_user_role();
  IF v_uid IS NULL OR v_role NOT IN ('member', 'admin') THEN
    RAISE EXCEPTION 'Only authenticated band members or admins can check items'
      USING ERRCODE = '42501';
  END IF;

  IF coalesce(btrim(p_item_id), '') = '' THEN
    RAISE EXCEPTION 'Item ID is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_condition NOT IN ('working', 'repair', 'missing') THEN
    RAISE EXCEPTION 'Invalid condition %. Must be working, repair, or missing.', p_condition
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_item
    FROM public.inventory
   WHERE id = p_item_id
     AND deleted_at IS NULL
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item % was not found or is deleted', p_item_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT p.email, p.first_name, p.last_name
    INTO v_email, v_first_name, v_last_name
    FROM public.profiles p
   WHERE p.id = v_uid;

  IF coalesce(btrim(v_email), '') = '' THEN
    SELECT u.email
      INTO v_email
      FROM auth.users u
     WHERE u.id = v_uid;
  END IF;

  v_checked_by := nullif(btrim(coalesce(v_first_name, '') || ' ' || coalesce(v_last_name, '')), '');
  IF v_checked_by IS NULL THEN
    v_checked_by := nullif(btrim(split_part(coalesce(v_email, ''), '@', 1)), '');
  END IF;
  IF v_checked_by IS NULL THEN
    v_checked_by := 'Team Member';
  END IF;

  v_date_checked := to_char(v_now, 'FMMonth FMDD, YYYY');
  v_action := CASE
    WHEN v_item.condition IS DISTINCT FROM p_condition THEN 'updated'
    ELSE 'checked'
  END;

  UPDATE public.inventory
     SET condition = p_condition,
         "checkedBy" = v_checked_by,
         "dateChecked" = v_date_checked,
         checked_at = v_now,
         remarks = coalesce(p_remarks, remarks),
         updated_at = v_now
   WHERE id = p_item_id
  RETURNING * INTO v_updated;

  v_hist_id := 'h_' || (extract(epoch FROM clock_timestamp()) * 1000)::bigint::text
    || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 9);

  INSERT INTO public.history_log (
    id,
    action,
    item_id,
    item_data,
    prev_data,
    user_email,
    undone,
    "timestamp"
  )
  VALUES (
    v_hist_id,
    v_action,
    v_updated.id,
    to_jsonb(v_updated),
    to_jsonb(v_item),
    coalesce(nullif(btrim(v_email), ''), 'unknown'),
    false,
    v_now
  );

  RETURN jsonb_build_object(
    'id', v_updated.id,
    'condition', v_updated.condition,
    'checkedBy', v_updated."checkedBy",
    'dateChecked', v_updated."dateChecked",
    'checked_at', v_updated.checked_at,
    'remarks', v_updated.remarks,
    'action', v_action
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. Phase 1 grants & Supabase Realtime publication wiring
-- ----------------------------------------------------------------------------
-- Protect new PII tables from anon even during Phase 1 while keeping legacy
-- inventory/history_log accessible for the live vanilla site.
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.loans FROM anon;

GRANT SELECT ON public.inventory_public TO anon, authenticated;
GRANT SELECT ON public.categories, public.locations TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories, public.locations, public.loans, public.profiles TO authenticated;

GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon, authenticated;
REVOKE ALL ON FUNCTION public.member_check_item(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_check_item(text, text, text) TO authenticated;

DO $$
DECLARE
  v_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_table IN ARRAY ARRAY['inventory', 'categories', 'locations', 'loans', 'history_log']
    LOOP
      IF to_regclass(format('public.%I', v_table)) IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime'
             AND schemaname = 'public'
             AND tablename = v_table
         )
      THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 10. Trailing diagnostic audit: legacy regex loan keywords in remarks/owner
-- ----------------------------------------------------------------------------
-- Review these rows and move any personal borrower info into public.loans
-- (and clean remarks) BEFORE running 002_phase2_rls_cutover.sql.
SELECT
  id,
  category,
  item,
  qty,
  owner,
  location,
  borrower,
  remarks,
  deleted_at
FROM public.inventory
WHERE coalesce(btrim(borrower), '') = ''
  AND (
    coalesce(remarks, '') ~* '\m(lent|borrow|loan)'
    OR coalesce(owner, '') ~* '\m(lent|borrow|loan)'
  )
ORDER BY deleted_at NULLS FIRST, category, item;
