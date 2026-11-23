-- ============================================================================
-- WINGMACC Band Inventory — Phase 4 Migration (Pre-Deploy Safety & Sync)
-- ============================================================================
-- Additive, idempotent migration designed to run on top of:
--   1. 001_phase1_extend_schema.sql
--   2. 002_phase2_rls_cutover.sql
--   3. 003_predeploy_enhancements.sql
--
-- Includes:
--   1. BEFORE DELETE triggers on categories & locations to clear stale
--      denormalized text columns (inventory.category / inventory.location)
--   2. BEFORE UPDATE trigger preventing inventory.qty from dropping below
--      active loaned units (returned_at IS NULL)
--   3. Add public.profiles to supabase_realtime publication for Admin Team sync
--   4. Host-pinned gear-photos URL validation in member_add_item_photo
--   5. get_item_comment_counts() RPC avoiding PostgREST 1,000-row cap
--   6. Allow clearing last_name in handle_user_profile_sync()
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Clear stale inventory text when Categories or Locations are deleted
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_inventory_category_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fallback_category text;
BEGIN
  IF OLD.parent_id IS NULL THEN
    v_fallback_category := CASE
      WHEN lower(btrim(coalesce(OLD.name, ''))) = 'others' THEN 'Uncategorized'
      ELSE 'Others'
    END;

    UPDATE public.inventory
       SET category_id = NULL,
           subcategory_id = NULL,
           category = v_fallback_category
     WHERE category_id = OLD.id;
  ELSE
    UPDATE public.inventory
       SET subcategory_id = NULL
     WHERE subcategory_id = OLD.id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_categories_before_delete ON public.categories;
CREATE TRIGGER trg_categories_before_delete
  BEFORE DELETE ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_inventory_category_on_delete();

CREATE OR REPLACE FUNCTION public.clear_inventory_location_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.inventory
     SET location_id = NULL,
         location = NULL
   WHERE location_id = OLD.id;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_locations_before_delete ON public.locations;
CREATE TRIGGER trg_locations_before_delete
  BEFORE DELETE ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_inventory_location_on_delete();

-- ----------------------------------------------------------------------------
-- 2. Prevent inventory.qty from being reduced below active loaned units
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_inventory_qty_above_active_loans()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_loaned int;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.qty IS NOT DISTINCT FROM OLD.qty THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(sum(qty_loaned), 0)::int
    INTO v_active_loaned
    FROM public.loans
   WHERE item_id = NEW.id
     AND returned_at IS NULL;

  IF coalesce(NEW.qty, 0) < v_active_loaned THEN
    RAISE EXCEPTION 'Cannot set quantity to % while % units are actively on loan for item %',
      coalesce(NEW.qty, 0), v_active_loaned, NEW.id
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_inventory_qty_above_active_loans ON public.inventory;
CREATE TRIGGER trg_guard_inventory_qty_above_active_loans
  BEFORE UPDATE OF qty ON public.inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_inventory_qty_above_active_loans();

-- ----------------------------------------------------------------------------
-- 3. Add public.profiles to supabase_realtime publication
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND to_regclass('public.profiles') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'profiles'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Pin member_add_item_photo URLs to the active Supabase project host
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_add_item_photo(
  p_item_id text,
  p_photo_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_photo_url text;
  v_req_headers jsonb;
  v_req_host text;
  v_expected_prefix text;
  v_item public.inventory%ROWTYPE;
  v_updated public.inventory%ROWTYPE;
  v_raw_img text;
  v_parsed jsonb;
  v_photos jsonb := '[]'::jsonb;
  v_new_photos jsonb;
  v_email text;
  v_now timestamptz := now();
  v_hist_id text;
BEGIN
  v_role := public.current_user_role();
  IF v_uid IS NULL OR v_role NOT IN ('member', 'admin') THEN
    RAISE EXCEPTION 'Only authenticated band members or admins can add item photos'
      USING ERRCODE = '42501';
  END IF;

  IF coalesce(btrim(p_item_id), '') = '' THEN
    RAISE EXCEPTION 'Item ID is required'
      USING ERRCODE = '22023';
  END IF;

  v_photo_url := btrim(coalesce(p_photo_url, ''));
  IF v_photo_url !~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/gear-photos/[^?#]+$'
     OR position('/../' IN v_photo_url) > 0
  THEN
    RAISE EXCEPTION 'Invalid gear-photos public URL'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_req_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_req_host := lower(nullif(btrim(coalesce(v_req_headers->>'host', '')), ''));
  EXCEPTION WHEN others THEN
    v_req_host := NULL;
  END;

  IF v_req_host IS NOT NULL AND v_req_host ~ '^[a-z0-9-]+\.supabase\.co$' THEN
    v_expected_prefix := 'https://' || v_req_host || '/storage/v1/object/public/gear-photos/';
    IF left(v_photo_url, char_length(v_expected_prefix)) <> v_expected_prefix THEN
      RAISE EXCEPTION 'Photo URL must belong to the active project gear-photos bucket'
        USING ERRCODE = '22023';
    END IF;
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

  v_raw_img := nullif(btrim(coalesce(v_item.image_filename, '')), '');
  IF v_raw_img IS NOT NULL THEN
    BEGIN
      v_parsed := v_raw_img::jsonb;
      IF jsonb_typeof(v_parsed) = 'array' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(btrim(elem #>> '{}'))), '[]'::jsonb)
          INTO v_photos
          FROM jsonb_array_elements(v_parsed) AS elem
         WHERE jsonb_typeof(elem) = 'string'
           AND btrim(elem #>> '{}') <> '';
      ELSIF jsonb_typeof(v_parsed) = 'string' THEN
        IF btrim(v_parsed #>> '{}') <> '' THEN
          v_photos := jsonb_build_array(btrim(v_parsed #>> '{}'));
        END IF;
      END IF;
    EXCEPTION WHEN others THEN
      v_photos := jsonb_build_array(v_raw_img);
    END;
  END IF;

  IF jsonb_array_length(v_photos) >= 4 THEN
    RAISE EXCEPTION 'Maximum of 4 photos reached for item %', p_item_id
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_photos) AS existing_url
    WHERE existing_url = v_photo_url
  ) THEN
    v_new_photos := v_photos;
  ELSE
    v_new_photos := v_photos || jsonb_build_array(v_photo_url);
  END IF;

  UPDATE public.inventory
     SET image_filename = v_new_photos::text,
         updated_at = v_now
   WHERE id = p_item_id
  RETURNING * INTO v_updated;

  SELECT p.email
    INTO v_email
    FROM public.profiles p
   WHERE p.id = v_uid;

  IF coalesce(btrim(v_email), '') = '' THEN
    SELECT u.email
      INTO v_email
      FROM auth.users u
     WHERE u.id = v_uid;
  END IF;

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
    'updated',
    v_updated.id,
    to_jsonb(v_updated),
    to_jsonb(v_item),
    coalesce(nullif(btrim(v_email), ''), 'unknown'),
    false,
    v_now
  );

  RETURN jsonb_build_object(
    'id', v_updated.id,
    'image_filename', v_updated.image_filename,
    'photos', v_new_photos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.member_add_item_photo(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_add_item_photo(text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Server-side comment count aggregation RPC (avoids 1,000-row PostgREST cap)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_item_comment_counts()
RETURNS TABLE (
  item_id text,
  comment_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT ic.item_id, count(*)::bigint AS comment_count
  FROM public.item_comments ic
  GROUP BY ic.item_id;
$$;

REVOKE ALL ON FUNCTION public.get_item_comment_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_item_comment_counts() TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Allow clearing last_name when updating Account Settings metadata
-- ----------------------------------------------------------------------------
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
  v_has_last boolean;
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

  v_has_last := coalesce(NEW.raw_user_meta_data, '{}'::jsonb) ? 'last_name';

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
         last_name = CASE
           WHEN v_has_last THEN v_last
           ELSE coalesce(v_last, last_name)
         END
   WHERE id = NEW.id;

  RETURN NEW;
END;
$$;
