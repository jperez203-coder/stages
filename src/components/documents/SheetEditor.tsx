"use client";

import { Plus, X } from "lucide-react";

export type SheetContent = { columns: string[]; rows: Record<string, string>[] };

/**
 * Minimal sheet editor: add row, add column, inline cell edit. No formulas,
 * no cell types, no sorting/filtering — deliberately stripped down per the
 * MVP scope (see Sidebar.tsx doc comment).
 */
export function SheetEditor({
  content,
  onChange,
}: {
  content: SheetContent;
  onChange: (next: SheetContent) => void;
}) {
  const columns = content.columns.length ? content.columns : ["Column 1"];
  const rows = content.rows;

  const renameColumn = (index: number, name: string) => {
    const oldName = columns[index];
    const nextColumns = columns.map((c, i) => (i === index ? name : c));
    const nextRows = rows.map((r) => {
      const { [oldName]: value, ...rest } = r;
      return { ...rest, [name]: value ?? "" };
    });
    onChange({ columns: nextColumns, rows: nextRows });
  };

  const addColumn = () => {
    let n = columns.length + 1;
    while (columns.includes(`Column ${n}`)) n++;
    onChange({ columns: [...columns, `Column ${n}`], rows });
  };

  const removeColumn = (index: number) => {
    const name = columns[index];
    const nextColumns = columns.filter((_, i) => i !== index);
    const nextRows = rows.map((r) => {
      const { [name]: _dropped, ...rest } = r;
      return rest;
    });
    onChange({ columns: nextColumns, rows: nextRows });
  };

  const addRow = () => {
    onChange({ columns, rows: [...rows, {}] });
  };

  const removeRow = (index: number) => {
    onChange({ columns, rows: rows.filter((_, i) => i !== index) });
  };

  const setCell = (rowIndex: number, col: string, value: string) => {
    const nextRows = rows.map((r, i) => (i === rowIndex ? { ...r, [col]: value } : r));
    onChange({ columns, rows: nextRows });
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              {columns.map((col, colIndex) => (
                <th key={colIndex} style={{ border: "1px solid #2D2E30", padding: 0, minWidth: 140 }}>
                  <div className="group flex items-center">
                    <input
                      value={col}
                      onChange={(e) => renameColumn(colIndex, e.target.value)}
                      className="flex-1 outline-none bg-transparent"
                      style={{
                        padding: "7px 8px",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#71717A",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => removeColumn(colIndex)}
                      aria-label={`Remove column ${col}`}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      style={{ background: "transparent", border: "none", cursor: "pointer", color: "#71717A", marginRight: 6 }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </th>
              ))}
              <th style={{ border: "none", width: 32 }}>
                <button
                  type="button"
                  onClick={addColumn}
                  aria-label="Add column"
                  className="flex items-center justify-center rounded transition-colors"
                  style={{ width: 24, height: 24, background: "transparent", border: "none", cursor: "pointer", color: "#71717A" }}
                >
                  <Plus size={14} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="group">
                {columns.map((col) => (
                  <td key={col} style={{ border: "1px solid #2D2E30", padding: 0 }}>
                    <input
                      value={row[col] ?? ""}
                      onChange={(e) => setCell(rowIndex, col, e.target.value)}
                      className="w-full outline-none bg-transparent"
                      style={{ padding: "7px 8px", fontSize: 13, color: "#E4E4E7" }}
                    />
                  </td>
                ))}
                <td style={{ border: "none" }}>
                  <button
                    type="button"
                    onClick={() => removeRow(rowIndex)}
                    aria-label="Remove row"
                    className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    style={{ width: 24, height: 24, background: "transparent", border: "none", cursor: "pointer", color: "#71717A" }}
                  >
                    <X size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1.5 transition-colors"
        style={{ marginTop: 4, padding: "7px 8px", background: "transparent", border: "none", cursor: "pointer", fontSize: 13, color: "#71717A" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#E4E4E7")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#71717A")}
      >
        <Plus size={13} /> New row
      </button>
    </div>
  );
}
