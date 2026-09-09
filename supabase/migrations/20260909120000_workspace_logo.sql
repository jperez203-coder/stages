-- Workspace logo upload — lets a workspace owner upload a custom image to
-- replace the generated "#" hash tile shown in the workspace switcher.
--
-- `logo_path` stores the storage path, not a public URL — the bucket is
-- private (same convention as stage_attachments/pipeline_files), so the app
-- resolves it to a signed URL at render time.

alter table public.workspaces
  add column if not exists logo_path text;

-- Bucket: workspace_logos
--   path convention: {workspace_id}/logo.{ext}
--   One logo per workspace — re-uploading overwrites the same path via
--   upsert, so no cleanup/orphan-file step is needed on replace.
insert into storage.buckets (id, name, public)
values ('workspace_logos', 'workspace_logos', false)
on conflict (id) do nothing;

-- SELECT: any workspace member can view the logo (it's a shared visual
-- identity, not privileged data).
create policy workspace_logos_storage_select on storage.objects
for select using (
  bucket_id = 'workspace_logos'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);

-- INSERT/UPDATE/DELETE: workspace owner only — matches workspaces_update's
-- existing owner-only gate on the row this path belongs to.
create policy workspace_logos_storage_insert on storage.objects
for insert with check (
  bucket_id = 'workspace_logos'
  and public.is_workspace_owner(((storage.foldername(name))[1])::uuid)
);

create policy workspace_logos_storage_update on storage.objects
for update using (
  bucket_id = 'workspace_logos'
  and public.is_workspace_owner(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'workspace_logos'
  and public.is_workspace_owner(((storage.foldername(name))[1])::uuid)
);

create policy workspace_logos_storage_delete on storage.objects
for delete using (
  bucket_id = 'workspace_logos'
  and public.is_workspace_owner(((storage.foldername(name))[1])::uuid)
);
