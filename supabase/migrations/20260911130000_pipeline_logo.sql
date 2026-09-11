-- Per-pipeline (= "Company"/portal) logo upload for the new create-portal
-- modal's icon/logo picker. Mirrors the workspace-logo feature
-- (20260909120000_workspace_logo.sql) exactly, scoped to a pipeline
-- instead of a workspace:
--
--   `logo_path` stores the storage path, not a public URL — the bucket is
--   private, resolved to a signed URL at render time.

alter table public.pipelines
  add column if not exists logo_path text;

-- Bucket: pipeline_logos
--   path convention: {pipeline_id}/logo.{ext}
--   One logo per pipeline — re-uploading overwrites the same path via
--   upsert, so no cleanup/orphan-file step is needed on replace.
insert into storage.buckets (id, name, public)
values ('pipeline_logos', 'pipeline_logos', false)
on conflict (id) do nothing;

-- SELECT: same visibility as the pipeline row itself (pipelines_select,
-- see 20260905120000) — agency members of the pipeline or its invited
-- client can view its logo.
create policy pipeline_logos_storage_select on storage.objects
for select using (
  bucket_id = 'pipeline_logos'
  and (
    public.is_pipeline_agency_member(((storage.foldername(name))[1])::uuid)
    or public.is_pipeline_client(((storage.foldername(name))[1])::uuid)
  )
);

-- INSERT/UPDATE/DELETE: same gate as editing the pipeline itself
-- (can_edit_pipeline — workspace owner, or pipeline owner/admin).
create policy pipeline_logos_storage_insert on storage.objects
for insert with check (
  bucket_id = 'pipeline_logos'
  and public.can_edit_pipeline(((storage.foldername(name))[1])::uuid)
);

create policy pipeline_logos_storage_update on storage.objects
for update using (
  bucket_id = 'pipeline_logos'
  and public.can_edit_pipeline(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'pipeline_logos'
  and public.can_edit_pipeline(((storage.foldername(name))[1])::uuid)
);

create policy pipeline_logos_storage_delete on storage.objects
for delete using (
  bucket_id = 'pipeline_logos'
  and public.can_edit_pipeline(((storage.foldername(name))[1])::uuid)
);
