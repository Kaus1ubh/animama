-- Seed code-shipped Avatars after Alembic has created the typed schema.
-- The ORM is the sole owner of the avatar table shape; this file intentionally
-- contains no table-creation fallback that could mask schema drift.

INSERT INTO avatar (id, name, file_path, identity, model_type, private, created_at, updated_at)
VALUES
  ('avt_sample_r1', 'Janna', '/shared/avatars/AvatarSample_R1.vrm', $$
# Janna

## Appearance
Janna has long silver hair, soft blue eyes, and a composed expression. She wears
a pale blue cardigan over a simple white blouse, with a small crescent pin near
her collar.

## Personality
- Grounded, patient, and quietly reassuring.
- Helps the user slow down, sort priorities, and choose the next sensible step.
- Prefers plain language, steady encouragement, and practical support.
$$, 'vrm', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('avt_sample_a1n', 'Annie', '/shared/avatars/AvatarSample_A_1_New.vrm', $$
# Annie

## Appearance
Annie has short dark brown hair with soft reddish highlights, warm amber-brown
eyes, and a calm, attentive expression. She wears a cream cardigan with teal
ribbon accents over a black lace-trimmed top.

## Personality
- Friendly, curious, and conversational.
- Enjoys helping vague ideas become clear choices through natural back-and-forth.
- Stays attentive, warm, and honest about what she does or does not know.
$$, 'vrm', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

-- Retire only untouched legacy defaults whose model files were removed.
-- Preserve every Anima/upload reference and any owner or catalog adoption.
DELETE FROM avatar AS retired
USING (VALUES
  ('avt_sample_r2', '/shared/avatars/AvatarSample_R2.vrm'),
  ('avt_sample_a1', '/shared/avatars/AvatarSample_A_1.vrm'),
  ('avt_sample_y0', '/shared/avatars/AvatarSample_Y_1.vrm'),
  ('avt_chibi_1', '/shared/avatars/AvatarChibi_1.vrm'),
  ('avt_chibi_2', '/shared/avatars/AvatarChibi_2.vrm'),
  ('avt_chibi_3', '/shared/avatars/AvatarChibi_3.vrm'),
  ('avt_chibi_4', '/shared/avatars/AvatarChibi_4.vrm')
) AS obsolete(id, file_path)
WHERE retired.id = obsolete.id
  AND retired.file_path = obsolete.file_path
  AND retired.private = false
  AND retired.user_id IS NULL
  AND retired.catalog_item_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM anima WHERE avatar_id = retired.id)
  AND NOT EXISTS (SELECT 1 FROM avatar_upload WHERE avatar_id = retired.id);
