# Stages — Supabase migrations & operations

This directory holds the Supabase schema and config. The `supabase` CLI is a project-local dev dependency (no global install needed). All commands below run via `npx supabase ...` from `stages/`.

## Layout

```
supabase/
├── config.toml              # CLI config (project_id, ports, etc.)
├── migrations/              # SQL migrations, applied in filename order
│   └── 20260508120000_initial_schema.sql
├── .gitignore               # excludes .temp/, .branches/, env keys
└── README.md                # this file
```

## First-time setup (one per machine)

When Supabase is back online and you're ready to apply the initial schema:

1. **Generate a personal access token.** Go to https://supabase.com/dashboard/account/tokens, click *Generate new token*, copy it. (It's like a GitHub PAT — paste-once, kept in your local CLI keychain afterward.)

2. **Log the CLI in.**
   ```sh
   npx supabase login
   ```
   It'll prompt for the token. Paste it.

3. **Link this directory to the remote project.**
   ```sh
   npx supabase link --project-ref fdukdjbrqtltqzhvmmsz
   ```
   This binds the local migrations folder to the `Stages mvp` project at https://fdukdjbrqtltqzhvmmsz.supabase.co. Only do this once; the link persists.

4. **Apply pending migrations.**
   ```sh
   npx supabase db push
   ```
   The CLI compares local migrations against what's been applied on the remote and pushes anything new. First run will apply `20260508120000_initial_schema.sql` end-to-end.

5. **Verify.** In the Supabase Dashboard → SQL Editor, run:
   ```sql
   select table_name from information_schema.tables where table_schema = 'public' order by table_name;
   ```
   You should see all 16 tables: `activity_events`, `channel_memberships`, `channel_messages`, `channels`, `client_invites`, `pipeline_links`, `pipeline_memberships`, `pipelines`, `profiles`, `read_state`, `stage_attachments`, `stage_notes`, `stages`, `tasks`, `team_invites`, `user_templates`, `workspace_memberships`, `workspaces`.

## Adding new migrations later

**Never edit a migration that's been applied.** Always create a new file:

```sh
npx supabase migration new <name>
# e.g. npx supabase migration new rls_policies
```

This generates `supabase/migrations/<timestamp>_<name>.sql` for you to fill in. Then `npx supabase db push` to apply.

## Useful commands

| Command | What it does |
| --- | --- |
| `npx supabase migration list` | Show local + remote migration state side-by-side |
| `npx supabase db push` | Apply pending migrations to the linked remote |
| `npx supabase db diff -f <name>` | Generate a migration from manual changes you made via the dashboard |
| `npx supabase db reset` | **Local only** — drops and re-runs all migrations against the local db (we don't run a local db yet, so this is informational) |
| `npx supabase link --project-ref <ref>` | Re-link to a different remote project |

## When something goes wrong

- **Auth errors during push** — re-run `npx supabase login`. The CLI's stored token may have expired.
- **"Migration X already applied" on a fresh project** — you're talking to the wrong remote. Check `npx supabase projects list`.
- **Need to roll back a migration** — write a new migration that reverses it. Don't delete the old file. The migration history is the audit trail.
