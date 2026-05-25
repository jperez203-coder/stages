"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { normalizeUrl } from "@/lib/normalize-url";

/**
 * Add-link modal — the form for adding a kind='url' row to a
 * pipeline_files list. Phase 4b-3-b agency-only (clients never see
 * the +Add affordances).
 *
 * Two fields: label + URL. Save gated on both non-empty after trim.
 * No URL format validation — Postgres accepts any text; if the URL is
 * malformed, the agency notices on first click (window.open will just
 * navigate weirdly). Keeping the friction low.
 *
 * onSave is async and may throw — modal catches the throw, surfaces
 * an inline error, leaves the form intact for retry.
 *
 * Close paths: X button, ESC, backdrop click, save success.
 */

type Props = {
  onCancel: () => void;
  onSave: (label: string, url: string) => Promise<void>;
};

export function AddLinkModal({ onCancel, onSave }: Props) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);

  const canSave = label.trim().length > 0 && url.trim().length > 0 && !saving;

  // Focus label input on mount.
  useEffect(() => {
    const t = setTimeout(() => labelInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  // ESC to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, saving]);

  const handleSave = async () => {
    if (!canSave) return;
    // Normalize the URL before persisting: bare domains like
    // "facebook.com" lack a protocol and get treated as relative
    // paths by window.open, 404ing on the app origin. normalizeUrl
    // prepends "https://" when no http(s) prefix is present, so the
    // row lands in the DB already absolute. (See lib/normalize-url.ts.)
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setError("Enter a URL.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(label.trim(), normalized);
      // Parent closes the modal on success — no setSaving(false) here
      // (component unmounts before the state would matter).
    } catch (e) {
      console.error("[add-link] save failed:", e);
      setError("Couldn't save link. Try again.");
      setSaving(false);
    }
  };

  return (
    <div
      onClick={() => {
        if (!saving) onCancel();
      }}
      role="dialog"
      aria-label="Add link"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          background: "#1A1A1C",
          border: "1px solid #36363A",
          borderRadius: 12,
          padding: 24,
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 700,
              color: "white",
            }}
          >
            Add link
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            aria-label="Close"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "transparent",
              border: "1px solid transparent",
              color: "rgba(255,255,255,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Label field */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "rgba(255,255,255,0.55)",
              textTransform: "uppercase",
              letterSpacing: 0.6,
            }}
          >
            Label
          </label>
          <input
            ref={labelInputRef}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Figma board"
            maxLength={120}
            disabled={saving}
            style={inputStyle}
          />
        </div>

        {/* URL field */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "rgba(255,255,255,0.55)",
              textTransform: "uppercase",
              letterSpacing: 0.6,
            }}
          >
            URL
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            disabled={saving}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) {
                e.preventDefault();
                void handleSave();
              }
            }}
            style={inputStyle}
          />
        </div>

        {error && (
          <div
            role="alert"
            style={{
              fontSize: 12,
              color: "#F43F5E",
              padding: "8px 10px",
              background: "rgba(244,63,94,0.08)",
              border: "1px solid rgba(244,63,94,0.3)",
              borderRadius: 6,
            }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={btnGhostStyle}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            style={{
              ...btnPrimaryStyle,
              opacity: canSave ? 1 : 0.5,
              cursor: canSave ? "pointer" : "not-allowed",
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#2C2C2F",
  border: "1px solid #36363A",
  borderRadius: 8,
  padding: "9px 12px",
  color: "white",
  fontSize: 14,
  outline: "none",
  fontFamily: "inherit",
};

const btnGhostStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "transparent",
  border: "1px solid #36363A",
  borderRadius: 8,
  color: "rgba(255,255,255,0.75)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const btnPrimaryStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#108CE9",
  border: "1px solid #108CE9",
  borderRadius: 8,
  color: "white",
  fontSize: 13,
  fontWeight: 600,
};
