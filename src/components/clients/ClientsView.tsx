"use client";

import { useState } from "react";
import { Building2, Search, User, Plus } from "lucide-react";
import { HomeGreeting } from "@/components/home/HomeGreeting";
import { HomeTabs } from "@/components/home/HomeTabs";
import { getAvatarColorFromUserId } from "@/lib/avatar-color";
import { resolveInitial } from "@/lib/display-name";
import { CreateClientModal } from "@/components/clients/CreateClientModal";
import type { CompanyOption } from "@/components/clients/CompanyPicker";
import type { CompanyRow, ClientRow } from "@/components/clients/types";

/**
 * /w/[slug]/clients — the workspace-wide Clients tab (Figma V2). Two
 * sub-views toggled by the pill row: Companies (one row per company, with
 * a stack of avatars for its client contacts) and Clients (one row per
 * individual contact, with their company). See CreateClientModal's doc
 * comment for why a client always requires a company but a project's
 * company link is optional.
 */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ClientsView({
  slug,
  firstName,
  workspaceId,
  initialCompanies,
  initialClients,
}: {
  slug: string;
  firstName: string | null;
  workspaceId: string;
  initialCompanies: CompanyRow[];
  initialClients: ClientRow[];
}) {
  const [view, setView] = useState<"companies" | "clients">("companies");
  const [companies, setCompanies] = useState(initialCompanies);
  const [clients, setClients] = useState(initialClients);
  const [createOpen, setCreateOpen] = useState(false);

  const companyOptions: CompanyOption[] = companies.map((c) => ({
    id: c.id,
    name: c.name,
    emoji: c.emoji,
  }));

  const handleCreated = (client: ClientRow) => {
    setCompanies((prev) =>
      prev.map((c) =>
        c.id === client.company.id ? { ...c, clients: [...c.clients, client] } : c,
      ),
    );
    setClients((prev) => [...prev, client]);
    setCreateOpen(false);
  };

  return (
    <div className="dotted-grid flex-1 px-6 pt-3 pb-6 overflow-y-auto overflow-x-hidden">
      <div className="max-w-[1600px] mx-auto mb-4">
        <HomeGreeting firstName={firstName} />
      </div>

      <div className="mb-6">
        <HomeTabs activeTab="clients" slug={slug} />
      </div>

      <div className="max-w-[1600px] mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setView("companies")}
              className="flex items-center gap-1.5 rounded-full transition-colors"
              style={{
                padding: "2px 12px",
                fontSize: 12,
                background: view === "companies" ? "#2C2C2F" : "transparent",
                border: "1px solid #36363A",
                color: view === "companies" ? "#E4E4E7" : "#979393",
                cursor: "pointer",
              }}
            >
              <Building2 size={12} /> Companies
            </button>
            <button
              type="button"
              onClick={() => setView("clients")}
              className="flex items-center gap-1.5 rounded-full transition-colors"
              style={{
                padding: "2px 12px",
                fontSize: 12,
                background: view === "clients" ? "#2C2C2F" : "transparent",
                border: "1px solid #36363A",
                color: view === "clients" ? "#E4E4E7" : "#979393",
                cursor: "pointer",
              }}
            >
              <User size={12} /> Clients
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Search (coming soon)"
              disabled
              className="flex items-center justify-center rounded transition-colors"
              style={{ width: 32, height: 32, background: "transparent", border: "none", color: "#71717A", cursor: "not-allowed" }}
            >
              <Search size={16} />
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 rounded-lg font-medium text-white transition-colors"
              style={{ padding: "6px 14px", background: "#108CE9", border: "none", fontSize: 13, cursor: "pointer" }}
            >
              <Plus size={14} /> Client
            </button>
          </div>
        </div>

        {view === "companies" ? (
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #2D2E30" }}>
                <th className="text-left font-normal text-[13px]" style={{ padding: "6px 8px", color: "#71717A" }}>Name</th>
                <th className="text-left font-normal text-[13px]" style={{ padding: "6px 8px", color: "#71717A" }}>Clients</th>
                <th className="text-left font-normal text-[13px]" style={{ padding: "6px 8px", color: "#71717A" }}>Created Date</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => {
                const { bg } = getAvatarColorFromUserId(company.id);
                return (
                  <tr key={company.id} style={{ borderBottom: "1px solid #212124" }}>
                    <td style={{ padding: "10px 8px" }}>
                      <div className="flex items-center gap-2">
                        <span
                          className="flex items-center justify-center flex-shrink-0"
                          style={{ width: 24, height: 24, borderRadius: 6, background: bg, fontSize: 13 }}
                        >
                          {company.emoji ?? "🏢"}
                        </span>
                        <span className="text-[13px]" style={{ color: "#E4E4E7" }}>{company.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      {company.clients.length === 0 ? (
                        <span className="text-[13px]" style={{ color: "#3A3A3E" }}>—</span>
                      ) : (
                        <div className="flex items-center">
                          {company.clients.map((client, i) => {
                            const { text, bg: clientBg } = getAvatarColorFromUserId(client.id);
                            return (
                              <div
                                key={client.id}
                                title={client.name}
                                className="flex items-center justify-center rounded-full"
                                style={{ width: 24, height: 24, marginLeft: i === 0 ? 0 : -8, background: "#101010", flexShrink: 0 }}
                              >
                                <div
                                  className="flex items-center justify-center rounded-full text-[11px] font-medium"
                                  style={{ width: 20, height: 20, background: clientBg, color: text }}
                                >
                                  {resolveInitial({ display_name: client.name })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <span className="text-[13px]" style={{ color: "#979393" }}>{formatDate(company.createdAt)}</span>
                    </td>
                  </tr>
                );
              })}
              {companies.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-[13px]" style={{ padding: "16px 8px", color: "#71717A" }}>
                    No companies yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #2D2E30" }}>
                <th className="text-left font-normal text-[13px]" style={{ padding: "6px 8px", color: "#71717A" }}>Name</th>
                <th className="text-left font-normal text-[13px]" style={{ padding: "6px 8px", color: "#71717A" }}>Company</th>
                <th className="text-left font-normal text-[13px]" style={{ padding: "6px 8px", color: "#71717A" }}>Created Date</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => {
                const { text, bg } = getAvatarColorFromUserId(client.id);
                const { bg: companyBg } = getAvatarColorFromUserId(client.company.id);
                return (
                  <tr key={client.id} style={{ borderBottom: "1px solid #212124" }}>
                    <td style={{ padding: "10px 8px" }}>
                      <div className="flex items-center gap-2">
                        <div
                          className="flex items-center justify-center rounded-full text-[12px] font-medium flex-shrink-0"
                          style={{ width: 28, height: 28, background: bg, color: text }}
                        >
                          {resolveInitial({ display_name: client.name })}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] truncate" style={{ color: "#E4E4E7" }}>{client.name}</div>
                          {client.email && (
                            <div className="text-[11px] truncate" style={{ color: "#71717A" }}>{client.email}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <div className="flex items-center gap-2">
                        <span
                          className="flex items-center justify-center flex-shrink-0"
                          style={{ width: 20, height: 20, borderRadius: 5, background: companyBg, fontSize: 11 }}
                        >
                          {client.company.emoji ?? "🏢"}
                        </span>
                        <span className="text-[13px]" style={{ color: "#979393" }}>{client.company.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <span className="text-[13px]" style={{ color: "#979393" }}>{formatDate(client.createdAt)}</span>
                    </td>
                  </tr>
                );
              })}
              {clients.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-[13px]" style={{ padding: "16px 8px", color: "#71717A" }}>
                    No clients yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <CreateClientModal
          slug={slug}
          workspaceId={workspaceId}
          companies={companyOptions}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
