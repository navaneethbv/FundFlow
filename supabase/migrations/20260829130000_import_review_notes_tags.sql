-- Stage Monarch notes and tags on the import review row so the preview can
-- show them and the commit can persist them as transaction annotations
-- without re-parsing the file. Backward compatible: existing staged rows
-- simply have no notes or tags, exactly as before.

alter table public.import_review_rows
  add column if not exists notes text,
  add column if not exists tags text[];