-- ============================================================================
-- WINGMACC Band Inventory — Phase 3 Migration (Pre-Deploy Enhancements)
-- ============================================================================
-- Additive, idempotent migration designed to run on top of:
--   1. 001_phase1_extend_schema.sql
--   2. 002_phase2_rls_cutover.sql
--
-- Includes:
--   1. public.equipment_types table + 9 seeded types + RLS/grants
--   2. Additive inventory columns (equipment_type_id, equipment_type, min_qty)
--      + idempotent keyword backfill for untagged items
--   3. Refreshed public.inventory_public view appending the new columns
--   4. public.item_comments table + immutability/pinning triggers + RLS/grants
--   5. Append-only member photo upload (gear-photos INSERT policy + RPC)
--   6. supabase_realtime publication wiring for equipment_types & item_comments
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Equipment Types table + seed + RLS/grants
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.equipment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  color text NOT NULL DEFAULT '#64748b',
  icon text DEFAULT 'tag',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS equipment_types_name_lower_uidx
  ON public.equipment_types (lower(btrim(name)));

INSERT INTO public.equipment_types (name, color, icon, sort_order)
VALUES
  ('Instruments', '#2563EB', 'guitar', 10),
  ('Amplifiers', '#d97740', 'speaker', 20),
  ('IEMs & Routing', '#9575b0', 'headphones', 30),
  ('Strings & Accessories', '#5fa777', 'music', 40),
  ('Bags & Cases', '#8b92a0', 'box', 50),
  ('Cables & Cords', '#4e7fb0', 'cable', 60),
  ('Stands & Hardware', '#4fa8a0', 'wrench', 70),
  ('DI Boxes & Effects', '#e8a33d', 'sliders', 80),
  ('Microphones', '#d3554a', 'mic', 90)
ON CONFLICT DO NOTHING;

REVOKE ALL ON public.equipment_types FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.equipment_types TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.equipment_types TO authenticated;

ALTER TABLE public.equipment_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipment_types_select_all" ON public.equipment_types;
CREATE POLICY "equipment_types_select_all"
  ON public.equipment_types
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "equipment_types_insert_admin" ON public.equipment_types;
CREATE POLICY "equipment_types_insert_admin"
  ON public.equipment_types
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "equipment_types_update_admin" ON public.equipment_types;
CREATE POLICY "equipment_types_update_admin"
  ON public.equipment_types
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "equipment_types_delete_admin" ON public.equipment_types;
CREATE POLICY "equipment_types_delete_admin"
  ON public.equipment_types
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 'admin');

-- ----------------------------------------------------------------------------
-- 2. Additive columns on public.inventory + idempotent keyword backfill
-- ----------------------------------------------------------------------------
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS equipment_type_id uuid REFERENCES public.equipment_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS equipment_type text,
  ADD COLUMN IF NOT EXISTS min_qty int CHECK (min_qty IS NULL OR min_qty >= 0);

CREATE INDEX IF NOT EXISTS inventory_equipment_type_id_idx
  ON public.inventory (equipment_type_id);

-- Backfill only rows where equipment_type_id IS NULL, ordered from most
-- specific accessory/cable/stand/case terms to general instrument keywords.
WITH classified AS (
  SELECT
    i.id,
    CASE
      WHEN coalesce(i.item, '') ~* '\m(bag|bags|case|cases|pouch|tote|(?:dust|amp|speaker|keyboard|mixer|drum)\s*cover)\M'
        THEN 'Bags & Cases'
      WHEN coalesce(i.item, '') ~* '\m(cable|cables|cord|cords|xlr|trs|speakon|snake|power\s*strip|power\s*supply|extension|adapter|adaptor|patch\s*lead)\M'
        THEN 'Cables & Cords'
      WHEN coalesce(i.item, '') ~* '\m(stand|stands|throne|mount|mounts|clamp|clamps|boom|holder|drum\s*rack|guitar\s*rack|hardware|clutch|beater|wingnut|kick\s*pedal|bass\s*drum\s*pedal|drum\s*pedal|hi-?hat\s*pedal)\M'
        THEN 'Stands & Hardware'
      WHEN coalesce(i.item, '') ~* '\m(strap|straps|capo|capos|drumstick|drumsticks|drum\s*stick|drum\s*sticks|sticks|strings|pick|picks|plectrum|drum\s*key|tuning\s*key|drum\s*head|drumhead|snare\s*head|tom\s*head|dampener|moongel|mute|mutes|sustain\s*pedal|damper\s*pedal|battery|batteries|charger|metronome|winder|polish|cloth)\M'
        OR (
          coalesce(i.item, '') ~* '\mstring\M'
          AND coalesce(i.item, '') !~* '\d+\s*-?\s*string\M'
        )
        THEN 'Strings & Accessories'
      WHEN coalesce(i.item, '') ~* '\m(di\s*box|direct\s*box|di|effects?|fx|pedalboard|pedals?|stompbox|tuner|preamp|pre-?amp|overdrive|distortion|delay|reverb|chorus|compressor|looper|multi-?fx|processor|attenuator|equalizer|eq)\M'
        THEN 'DI Boxes & Effects'
      WHEN coalesce(i.item, '') ~* '\m(mic|mics|microphone|microphones|sm57|sm58|beta\s*52|beta\s*57|beta\s*58|beta\s*87|e602|e604|e609|e835|e906|e935|condenser|vocal\s*mic|drum\s*mic|wireless\s*mic|lavalier|lapel|shotgun\s*mic)\M'
        THEN 'Microphones'
      WHEN coalesce(i.item, '') ~* '\m(amp|amps|amplifier|amplifiers|combo|cabinet|cab|subwoofer|speaker|speakers|monitor\s*speaker|pa\s*speaker|stage\s*monitor|floor\s*monitor|wedge|head\s*amp|amp\s*head)\M'
        THEN 'Amplifiers'
      WHEN coalesce(i.item, '') ~* '\m(iem|iems|in-?ear|in-?ears|earphone|earphones|earpiece|earpieces|headphone|headphones|p16|monitor\s*mixer|personal\s*mixer|splitter|router|routing|interface|mixer|stage\s*box|snake\s*box|transmitter|receiver|bodypack|wireless\s*pack)\M'
        OR coalesce(i.category, '') ~* '\m(in-?ear|iem)\M'
        THEN 'IEMs & Routing'
      WHEN coalesce(i.item, '') ~* '\m(guitar|guitars|bass|drum|drums|snare|tom|toms|kick|bass\s*drum|cymbal|cymbals|hi-?hat|ride|crash|splash|china|percussion|cajon|djembe|conga|congas|bongo|bongos|shaker|tambourine|cowbell|keyboard|keyboards|piano|synth|synthesizer|stage\s*piano|controller|ukulele|violin|cello|saxophone|trumpet|flute|acoustic|electric|classical|stratocaster|telecaster|les\s*paul|jazz\s*bass|precision\s*bass|nord|roland|yamaha|korg|pearl|tama|zildjian|sabian|meinl|paiste)\M'
        OR coalesce(i.category, '') ~* '\m(drums?|bass\s*rig|electric\s*guitar|acoustic|classical|keyboard)\M'
        THEN 'Instruments'
      ELSE NULL
    END AS matched_type_name
  FROM public.inventory i
  WHERE i.equipment_type_id IS NULL
)
UPDATE public.inventory i
   SET equipment_type_id = et.id,
       equipment_type = et.name
  FROM classified c
  JOIN public.equipment_types et
    ON lower(btrim(et.name)) = lower(btrim(c.matched_type_name))
 WHERE i.id = c.id
   AND i.equipment_type_id IS NULL
   AND c.matched_type_name IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Refresh public.inventory_public view (append new columns at end)
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
  greatest(coalesce(i.qty, 0)::int - coalesce(l.qty_on_loan, 0)::int, 0)::int AS available_qty,
  i.equipment_type_id,
  i.equipment_type,
  i.min_qty
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

REVOKE ALL ON public.inventory_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inventory_public TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Formal item_comments table + immutability triggers + RLS/grants
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.item_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id text NOT NULL REFERENCES public.inventory(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  author_email text NOT NULL,
  tag text NOT NULL DEFAULT 'note' CHECK (tag IN ('note', 'issue', 'repair', 'setup')),
  body text NOT NULL CHECK (btrim(body) <> '' AND char_length(body) <= 2000),
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS item_comments_item_pinned_created_idx
  ON public.item_comments (item_id, pinned DESC, created_at DESC);

CREATE OR REPLACE FUNCTION public.handle_item_comment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_auth_email text;
  v_first_name text;
  v_last_name text;
  v_meta_full text;
  v_meta_first text;
  v_meta_last text;
  v_author_name text;
BEGIN
  NEW.user_id := v_uid;

  IF v_uid IS NOT NULL THEN
    SELECT p.email, p.first_name, p.last_name
      INTO v_email, v_first_name, v_last_name
      FROM public.profiles p
     WHERE p.id = v_uid;

    SELECT
      u.email,
      nullif(btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'username', '')), ''),
      nullif(btrim(coalesce(u.raw_user_meta_data->>'first_name', '')), ''),
      nullif(btrim(coalesce(u.raw_user_meta_data->>'last_name', '')), '')
      INTO v_auth_email, v_meta_full, v_meta_first, v_meta_last
      FROM auth.users u
     WHERE u.id = v_uid;

    v_email := coalesce(nullif(btrim(v_email), ''), nullif(btrim(v_auth_email), ''));

    v_author_name := nullif(btrim(coalesce(v_first_name, '') || ' ' || coalesce(v_last_name, '')), '');
    IF v_author_name IS NULL THEN
      v_author_name := v_meta_full;
    END IF;
    IF v_author_name IS NULL THEN
      v_author_name := nullif(btrim(coalesce(v_meta_first, '') || ' ' || coalesce(v_meta_last, '')), '');
    END IF;
    IF v_author_name IS NULL THEN
      v_author_name := nullif(btrim(split_part(coalesce(v_email, ''), '@', 1)), '');
    END IF;
    IF v_author_name IS NULL THEN
      v_author_name := 'Team Member';
    END IF;

    NEW.author_name := v_author_name;
    NEW.author_email := coalesce(nullif(btrim(v_email), ''), 'unknown');
  ELSE
    NEW.author_name := coalesce(nullif(btrim(NEW.author_name), ''), 'Team Member');
    NEW.author_email := coalesce(nullif(btrim(NEW.author_email), ''), 'unknown');
  END IF;

  IF public.current_user_role() <> 'admin' THEN
    NEW.pinned := false;
  ELSE
    NEW.pinned := coalesce(NEW.pinned, false);
  END IF;

  NEW.created_at := now();
  NEW.updated_at := NEW.created_at;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_item_comment_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.author_email IS DISTINCT FROM OLD.author_email
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Immutable comment fields cannot be modified'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.pinned IS DISTINCT FROM OLD.pinned
     AND public.current_user_role() <> 'admin'
  THEN
    RAISE EXCEPTION 'Only admins can pin or unpin comments'
      USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_item_comments_before_insert ON public.item_comments;
CREATE TRIGGER trg_item_comments_before_insert
  BEFORE INSERT ON public.item_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_item_comment_insert();

DROP TRIGGER IF EXISTS trg_item_comments_before_update ON public.item_comments;
CREATE TRIGGER trg_item_comments_before_update
  BEFORE UPDATE ON public.item_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_item_comment_update();

REVOKE ALL ON public.item_comments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_comments TO authenticated;

ALTER TABLE public.item_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "item_comments_select_member_or_admin" ON public.item_comments;
CREATE POLICY "item_comments_select_member_or_admin"
  ON public.item_comments
  FOR SELECT
  TO authenticated
  USING (public.current_user_role() IN ('member', 'admin'));

DROP POLICY IF EXISTS "item_comments_insert_member_or_admin" ON public.item_comments;
CREATE POLICY "item_comments_insert_member_or_admin"
  ON public.item_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_role() IN ('member', 'admin'));

DROP POLICY IF EXISTS "item_comments_update_owner_or_admin" ON public.item_comments;
CREATE POLICY "item_comments_update_owner_or_admin"
  ON public.item_comments
  FOR UPDATE
  TO authenticated
  USING (
    (user_id = auth.uid() AND public.current_user_role() IN ('member', 'admin'))
    OR public.current_user_role() = 'admin'
  )
  WITH CHECK (
    (user_id = auth.uid() AND public.current_user_role() IN ('member', 'admin'))
    OR public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "item_comments_delete_owner_or_admin" ON public.item_comments;
CREATE POLICY "item_comments_delete_owner_or_admin"
  ON public.item_comments
  FOR DELETE
  TO authenticated
  USING (
    (user_id = auth.uid() AND public.current_user_role() IN ('member', 'admin'))
    OR public.current_user_role() = 'admin'
  );

-- ----------------------------------------------------------------------------
-- 5. Append-only Member Photo Upload (storage INSERT policy + RPC)
-- ----------------------------------------------------------------------------
-- Replace 002's admin-only INSERT policy so authenticated members and admins
-- can upload new photos to gear-photos, while UPDATE & DELETE remain admin-only.
DROP POLICY IF EXISTS "gear_photos_admin_insert" ON storage.objects;
DROP POLICY IF EXISTS "gear_photos_insert_member_or_admin" ON storage.objects;
CREATE POLICY "gear_photos_insert_member_or_admin"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'gear-photos'
    AND public.current_user_role() IN ('member', 'admin')
  );

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
-- 6. Supabase Realtime publication wiring
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_table IN ARRAY ARRAY['equipment_types', 'item_comments']
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
