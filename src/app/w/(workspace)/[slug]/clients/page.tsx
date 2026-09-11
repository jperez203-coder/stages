import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ClientsView } from "@/components/clients/ClientsView";
import type { CompanyRow, ClientRow } from "@/components/clients/types";

/**
 * /w/[slug]/clients — the workspace-wide Clients tab (Figma V2): every
 * company and every individual client contact in the workspace, toggled
 * between two views. See ClientsView's doc comment for the Company vs
 * Client distinction.
 *
 * Auth + redirect rules mirror /tasks (same known gap: doesn't handle the
 * pipeline-only-member fallback the dashboard has).
 */

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) {
    redirect(`/auth/signin?next=/w/${encodeURIComponent(slug)}/clients`);
  }

  const wsMembershipResult = await supabase
    .from("workspace_memberships")
    .select(`role, workspace:workspaces!inner(id, name, slug)`)
    .eq("user_id", user.id)
    .eq("workspace.slug", slug)
    .maybeSingle();

  type WsRow = { id: string; name: string; slug: string };
  const wsRaw = wsMembershipResult.data?.workspace as unknown;
  const ws: WsRow | null = Array.isArray(wsRaw)
    ? ((wsRaw[0] as WsRow | undefined) ?? null)
    : ((wsRaw as WsRow | null) ?? null);

  if (!wsMembershipResult.data || !ws) {
    const clientResult = await supabase
      .from("pipeline_memberships")
      .select(
        `pipeline_id, pipeline:pipelines!inner(workspace_id, workspace:workspaces!inner(slug))`,
      )
      .eq("user_id", user.id)
      .eq("role", "client")
      .eq("pipeline.workspace.slug", slug)
      .limit(1)
      .maybeSingle();

    if (clientResult.data) {
      redirect(`/portal/${clientResult.data.pipeline_id}`);
    }

    const profileResult = await supabase
      .from("profiles")
      .select("last_active_workspace_id")
      .eq("id", user.id)
      .maybeSingle();

    const lastActiveId = profileResult.data?.last_active_workspace_id;
    if (lastActiveId) {
      const lastWsResult = await supabase
        .from("workspaces")
        .select("slug")
        .eq("id", lastActiveId)
        .maybeSingle();
      if (lastWsResult.data?.slug && lastWsResult.data.slug !== slug) {
        redirect(`/w/${lastWsResult.data.slug}`);
      }
    }

    redirect("/");
  }

  const [profileRes, companiesRes, clientsRes] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    // A "Company" is a pipeline, renamed — see 20260911120000's migration
    // comment. is_system excludes the hidden per-workspace "Unassigned"
    // pipeline used as the Task tab's optional-project fallback; that one
    // was never meant to be a real client-facing company.
    supabase
      .from("pipelines")
      .select("id, name, emoji, created_at")
      .eq("workspace_id", ws.id)
      .eq("is_system", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, name, email, created_at, company:pipelines!inner(id, name, emoji)")
      .eq("workspace_id", ws.id)
      .order("created_at", { ascending: false }),
  ]);

  if (companiesRes.error) {
    console.error("[clients] companies fetch failed:", companiesRes.error.message);
  }
  if (clientsRes.error) {
    console.error("[clients] clients fetch failed:", clientsRes.error.message);
  }

  type CompanyJoin = { id: string; name: string; emoji: string | null };
  const flattenCompany = (c: unknown): CompanyJoin | null => {
    const obj = (Array.isArray(c) ? c[0] : c) as CompanyJoin | undefined;
    return obj ?? null;
  };

  const clients: ClientRow[] = (clientsRes.data ?? [])
    .map((row) => {
      const company = flattenCompany(row.company);
      if (!company) return null;
      return {
        id: row.id,
        name: row.name,
        email: row.email as string | null,
        createdAt: row.created_at as string,
        company,
      };
    })
    .filter((c): c is ClientRow => c !== null);

  const clientsByCompanyId = new Map<string, ClientRow[]>();
  for (const client of clients) {
    const list = clientsByCompanyId.get(client.company.id) ?? [];
    list.push(client);
    clientsByCompanyId.set(client.company.id, list);
  }

  const companies: CompanyRow[] = (companiesRes.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    emoji: c.emoji as string | null,
    createdAt: c.created_at as string,
    clients: (clientsByCompanyId.get(c.id) ?? []).map((cl) => ({
      id: cl.id,
      name: cl.name,
      email: cl.email,
    })),
  }));

  const rawName = profileRes.data?.display_name ?? null;
  const emailLocal = user.email?.split("@")[0] ?? null;
  const nameBase = rawName && rawName.trim() ? rawName.trim() : emailLocal;
  const firstWord = nameBase ? nameBase.split(/\s+/)[0] : "";
  const firstName = firstWord ? firstWord[0].toUpperCase() + firstWord.slice(1) : null;

  return (
    <ClientsView
      slug={slug}
      firstName={firstName}
      workspaceId={ws.id}
      initialCompanies={companies}
      initialClients={clients}
    />
  );
}
