"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Building2, ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { CompanyPicker, type CompanyOption } from "@/components/clients/CompanyPicker";
import type { ClientRow } from "@/components/clients/types";

/**
 * "+ Client" creation modal. A client always belongs to a company —
 * unlike a Project's optional company link, this one is required
 * (clients.company_id is not null). A Company IS a pipeline (see
 * 20260911120000's migration comment), so this only ever picks from
 * companies that already exist — creating a new one is the full
 * name+emoji+template portal flow at /w/[slug]/p/new, not something to
 * shortcut from here with just a name (see CompanyPicker's doc comment).
 * Name is the only other requirement; email is optional (a client
 * contact without an email just can't be portal-invited yet).
 */

type Props = {
  slug: string;
  workspaceId: string;
  companies: CompanyOption[];
  onClose: () => void;
  onCreated: (client: ClientRow) => void;
};

export function CreateClientModal({ slug, workspaceId, companies, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyAnchor, setCompanyAnchor] = useState<HTMLButtonElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCompany = companyId ? companies.find((c) => c.id === companyId) ?? null : null;
  const canSubmit = name.trim().length > 0 && !!selectedCompany && !submitting;

  const handleSubmit = async () => {
    const cleanedName = name.trim();
    if (!cleanedName || !selectedCompany) return;
    setSubmitting(true);
    setError(null);

    const { data: clientData, error: clientError } = await supabase
      .from("clients")
      .insert({
        workspace_id: workspaceId,
        company_id: selectedCompany.id,
        name: cleanedName,
        email: email.trim() || null,
      })
      .select("id, name, email, created_at")
      .single();

    setSubmitting(false);
    if (clientError || !clientData) {
      console.error("[create-client] client insert failed:", clientError?.message);
      setError(clientError?.message ?? "Couldn't create the client.");
      return;
    }

    onCreated({
      id: clientData.id,
      name: clientData.name,
      email: clientData.email,
      createdAt: clientData.created_at,
      company: selectedCompany,
    });
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fade-in"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label="Create client"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 440,
          background: "#18181B",
          border: "1px solid #2D2E30",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        }}
      >
        <div
          className="flex items-center justify-between flex-shrink-0"
          style={{ padding: "14px 16px", borderBottom: "1px solid #2D2E30" }}
        >
          <div className="flex items-center gap-2">
            <div
              className="flex items-center justify-center rounded-md"
              style={{ width: 22, height: 22, background: "#8B5CF6" }}
            >
              <Building2 size={13} color="white" />
            </div>
            <span className="text-[14px] font-medium" style={{ color: "#E4E4E7" }}>
              Client
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center rounded-full transition-colors"
            style={{ width: 28, height: 28, background: "#2C2C2F", border: "none", color: "#979393", cursor: "pointer" }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: "16px" }}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Client name"
            className="w-full text-[20px] font-semibold outline-none mb-3"
            style={{ background: "transparent", border: "none", color: "#E4E4E7" }}
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (optional)"
            className="w-full text-[14px] outline-none mb-4"
            style={{ background: "transparent", border: "none", color: "#E4E4E7" }}
          />

          <button
            type="button"
            onClick={(e) => setCompanyAnchor((prev) => (prev ? null : e.currentTarget))}
            className="flex items-center gap-1.5 rounded-lg transition-colors"
            style={{ padding: "6px 10px", background: "#111111", border: "none", color: selectedCompany ? "#E4E4E7" : "#979393", cursor: "pointer" }}
          >
            {selectedCompany?.emoji ? (
              <span style={{ fontSize: 14, lineHeight: 1 }}>{selectedCompany.emoji}</span>
            ) : (
              <Building2 size={14} />
            )}
            <span className="text-[13px] font-medium">{selectedCompany?.name ?? "Select company"}</span>
            <ChevronDown size={13} style={{ color: "#E4E4E7" }} />
          </button>
          {companyAnchor && (
            <CompanyPicker
              anchor={companyAnchor}
              companies={companies}
              selectedId={companyId}
              slug={slug}
              onSelectExisting={(id) => {
                setCompanyId(id);
                setCompanyAnchor(null);
              }}
              onClose={() => setCompanyAnchor(null)}
            />
          )}

          {error && (
            <p className="text-[12px] mt-3" style={{ color: "#F43F5E" }}>
              {error}
            </p>
          )}
        </div>

        <div
          className="flex items-center justify-end flex-shrink-0"
          style={{ padding: "14px 16px", borderTop: "1px solid #2D2E30" }}
        >
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="rounded-lg font-medium text-white transition-colors"
            style={{
              padding: "8px 18px",
              background: "#108CE9",
              border: "none",
              fontSize: 14,
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            {submitting ? "Creating…" : "Create Client"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
