"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Bold, Heading1, Heading2, Italic, List, Pilcrow } from "lucide-react";

/**
 * Minimal block doc editor. Blocks are { id, type, text } where `text` is
 * an HTML fragment (plain text plus inline <b>/<i> from the selection
 * toolbar's execCommand calls) — not plain text. Earlier this was kept as
 * plain strings for easy future plain-text extraction (embeddings); per
 * Jordan's explicit ask for Notion/Google-Docs-style select-to-bold, inline
 * formatting is supported now. Stripping tags for a future extraction pass
 * is still a one-line regex, so this doesn't paint that feature into a
 * corner. Block-level formatting (paragraph/heading/bullet) is unchanged.
 *
 * `id` is REQUIRED (not just a nice-to-have): blocks are rendered with
 * `key={block.id}` and refs are looked up by id, not array position.
 * Position-based keys/refs broke Enter/Backspace here — inserting or
 * removing a block shifts every later block to a new array index, and with
 * index-based keys React reuses the wrong DOM node for that index across
 * the shift, so a ref grabbed "at index+1 next frame" could resolve to a
 * stale/wrong node. Stable ids sidestep the whole class of bug. Legacy
 * content saved before ids existed is upgraded on load in page.tsx.
 *
 * Undo/redo (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z) is a custom history stack, not
 * the browser's native contentEditable undo — native undo is unreliable
 * once React is also managing the DOM, and can't span structural edits
 * (new block, merge, delete) the way a real document's undo should. Typing
 * is coalesced into one undo step per ~600ms pause (matches the general
 * feel of Docs/Notion); structural edits and formatting each commit
 * immediately as their own step.
 */

export type DocBlock = { id: string; type: "p" | "h1" | "h2" | "bullet"; text: string };
export type DocContent = { blocks: DocBlock[] };

function makeId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

const BLOCK_TYPES: { type: DocBlock["type"]; icon: typeof Pilcrow; label: string }[] = [
  { type: "p", icon: Pilcrow, label: "Text" },
  { type: "h1", icon: Heading1, label: "Heading 1" },
  { type: "h2", icon: Heading2, label: "Heading 2" },
  { type: "bullet", icon: List, label: "Bullet" },
];

function blockStyle(type: DocBlock["type"]): React.CSSProperties {
  switch (type) {
    case "h1":
      return { fontSize: 26, fontWeight: 700, color: "#E4E4E7" };
    case "h2":
      return { fontSize: 19, fontWeight: 600, color: "#E4E4E7" };
    default:
      return { fontSize: 14, fontWeight: 400, color: "#E4E4E7" };
  }
}

function plainTextLength(html: string): number {
  if (typeof document === "undefined") return html.length;
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").length;
}

function getCaretTextOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return plainTextLength(el.innerHTML);
  const range = sel.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Splits one block's HTML back into per-line HTML strings, based on
// top-level <div>/<p> wrappers or bare <br> separators — the shapes
// browsers actually produce when a multi-paragraph paste lands as internal
// markup inside ONE contentEditable instead of separate blocks (the "Enter
// jumps into existing text" bug: paste predates the paste-splitting fix
// above). Returns [html] unchanged if there's nothing to split.
function splitMergedBlockHtml(html: string): string[] {
  if (typeof document === "undefined") return [html];
  const container = document.createElement("div");
  container.innerHTML = html;
  const lines: string[] = [];
  let current = "";
  const flush = () => {
    lines.push(current);
    current = "";
  };
  Array.from(container.childNodes).forEach((node) => {
    if (node.nodeType === 1) {
      const tag = (node as HTMLElement).tagName;
      if (tag === "BR") {
        flush();
        return;
      }
      if (tag === "DIV" || tag === "P") {
        if (current !== "") flush();
        current = (node as HTMLElement).innerHTML;
        flush();
        return;
      }
      current += (node as HTMLElement).outerHTML;
    } else if (node.nodeType === 3) {
      current += node.textContent ?? "";
    }
  });
  if (current !== "") flush();
  return lines.length > 1 ? lines : [html];
}

// Repairs already-saved documents whose paste predates the fix above: any
// plain-paragraph block that actually contains multiple merged lines gets
// expanded into separate real blocks. Only touches type "p" — a block the
// user explicitly set to a heading/bullet is assumed intentional, not a
// paste artifact. Text-preserving either way: worst case it's a no-op.
export function repairMergedBlocks(blocks: DocBlock[]): DocBlock[] {
  const result: DocBlock[] = [];
  for (const block of blocks) {
    if (block.type !== "p") {
      result.push(block);
      continue;
    }
    const lines = splitMergedBlockHtml(block.text);
    if (lines.length <= 1) {
      result.push(block);
      continue;
    }
    lines.forEach((line, i) => {
      result.push({ id: i === 0 ? block.id : makeId(), type: "p", text: line });
    });
  }
  return result;
}

function isCaretAtStart(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;
  const preRange = range.cloneRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length === 0;
}

function setCaretAtTextOffset(el: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
    remaining -= len;
  }
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

type BlockRowHandle = {
  focusAtStart: () => void;
  focusAtEnd: () => void;
  applyFormat: (command: "bold" | "italic") => void;
  getElement: () => HTMLDivElement | null;
};

const BlockRow = forwardRef<
  BlockRowHandle,
  {
    block: DocBlock;
    onTextChange: (html: string) => void;
    onFormatChange: (html: string) => void;
    onTypeChange: (type: DocBlock["type"]) => void;
    onEnter: (beforeCaretHtml: string, afterCaretHtml: string) => void;
    onBackspaceAtStart: () => void;
    onPasteLines: (beforeCaret: string, afterCaret: string, lines: string[]) => void;
  }
>(function BlockRow(
  { block, onTextChange, onFormatChange, onTypeChange, onEnter, onBackspaceAtStart, onPasteLines },
  ref,
) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const lastSynced = useRef<string | null>(null);

  // Only touch the live DOM when `block.text` changed for a reason OTHER
  // than this element's own onInput (undo/redo, a merge from a neighboring
  // block, initial mount). Local typing already updated the DOM natively;
  // re-applying the same string via innerHTML would reset the caret.
  useEffect(() => {
    if (divRef.current && block.text !== lastSynced.current) {
      divRef.current.innerHTML = block.text;
      lastSynced.current = block.text;
    }
  }, [block.text]);

  useImperativeHandle(ref, () => ({
    focusAtStart() {
      const el = divRef.current;
      if (!el) return;
      // preventScroll + an explicit "nearest" scroll afterward, instead of
      // letting the browser's default focus-triggered scroll run. A just-
      // inserted node's default focus-scroll heuristic was jumping the
      // whole page to the bottom instead of the small nudge you'd expect
      // from adding one line.
      el.focus({ preventScroll: true });
      setCaretAtTextOffset(el, 0);
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
    focusAtEnd() {
      const el = divRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      setCaretAtTextOffset(el, plainTextLength(block.text));
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
    applyFormat(command) {
      const el = divRef.current;
      if (!el) return;
      el.focus();
      document.execCommand(command);
      const html = el.innerHTML;
      lastSynced.current = html;
      onFormatChange(html);
    },
    getElement() {
      return divRef.current;
    },
  }));

  const isEmpty = plainTextLength(block.text) === 0;

  return (
    <div className="group" style={{ position: "relative" }}>
      {/* Format toolbar floats ABOVE the line, near its start — not a
          layout sibling of the text. A trailing/leading flex sibling
          either shifts the text's left edge (leading) or ends up far off
          to the right of short lines once the column is wide (trailing),
          which is what made this look "removed." Absolute positioning
          keeps it right next to the text regardless of row width. */}
      <div
        className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          position: "absolute",
          top: -24,
          left: 0,
          background: "#1B1B1D",
          border: "1px solid #2D2E30",
          borderRadius: 6,
          padding: 1,
          zIndex: 5,
        }}
      >
        {BLOCK_TYPES.map(({ type, icon: Icon, label }) => (
          <button
            key={type}
            type="button"
            title={label}
            onClick={() => onTypeChange(type)}
            className="flex items-center justify-center rounded transition-colors"
            style={{
              width: 20,
              height: 20,
              background: block.type === type ? "#2C2C2F" : "transparent",
              border: "none",
              cursor: "pointer",
              color: block.type === type ? "#E4E4E7" : "#71717A",
            }}
          >
            <Icon size={12} />
          </button>
        ))}
      </div>

      <div className="flex items-start gap-1.5">
        {block.type === "bullet" && (
          <span style={{ color: "#71717A", fontSize: 14, lineHeight: "22px", flexShrink: 0 }}>•</span>
        )}
        <div
          ref={divRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          data-placeholder={block.type === "p" ? "Type something…" : ""}
          onInput={(e) => {
            const html = e.currentTarget.innerHTML;
            lastSynced.current = html;
            onTextChange(html);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              // Split AT THE CARET, like every real editor — the previous
              // version always tacked a blank line onto the very END of
              // the block regardless of where the cursor was, which is
              // what made Enter look like it "jumped to the bottom" on
              // any block with more than one visual line in it.
              const el = e.currentTarget;
              const sel = window.getSelection();
              if (!sel || sel.rangeCount === 0) {
                onEnter(el.innerHTML, "");
                return;
              }
              const range = sel.getRangeAt(0);
              const afterRange = range.cloneRange();
              afterRange.selectNodeContents(el);
              afterRange.setStart(range.startContainer, range.startOffset);
              const afterFragment = afterRange.extractContents();
              const afterDiv = document.createElement("div");
              afterDiv.appendChild(afterFragment);
              const beforeHtml = el.innerHTML;
              const afterHtml = afterDiv.innerHTML;
              lastSynced.current = beforeHtml;
              onEnter(beforeHtml, afterHtml);
            } else if (e.key === "Backspace" && isCaretAtStart(e.currentTarget)) {
              e.preventDefault();
              onBackspaceAtStart();
            }
          }}
          onPaste={(e) => {
            // Force plain text — this is the real bug behind "Enter jumps
            // to the bottom": pasting rich, multi-paragraph content (from
            // a doc, ChatGPT, etc.) let the browser insert its own nested
            // <div>/<br> structure INSIDE this one block, so what looked
            // like many lines was secretly a single block — Enter kept
            // inserting a new block right after that one giant block,
            // which is the end of the document. A single-line paste just
            // inserts at the caret; a multi-line paste splits into one
            // real block per line so Enter/Backspace work normally on them
            // afterward.
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            if (!text) return;
            const lines = text.split(/\r\n|\r|\n/);
            if (lines.length <= 1) {
              document.execCommand("insertText", false, text);
              return;
            }
            const el = divRef.current;
            if (!el) return;
            const offset = getCaretTextOffset(el);
            const full = el.textContent ?? "";
            onPasteLines(full.slice(0, offset), full.slice(offset), lines);
          }}
          className={`doc-block-editable flex-1 outline-none bg-transparent ${isEmpty ? "doc-block-empty" : ""}`}
          style={{ ...blockStyle(block.type), lineHeight: "22px", minHeight: 22, wordBreak: "break-word" }}
        />
      </div>
    </div>
  );
});

export function DocEditor({
  content,
  onChange,
}: {
  content: DocContent;
  onChange: (next: DocContent) => void;
}) {
  const blocks = content.blocks.length ? content.blocks : [{ id: makeId(), type: "p" as const, text: "" }];
  const refs = useRef<Map<string, BlockRowHandle>>(new Map());
  const lastSplitAtRef = useRef(0);

  // ── Undo/redo history ──────────────────────────────────────────────────
  const historyRef = useRef<{ past: DocBlock[][]; future: DocBlock[][] }>({ past: [], future: [] });
  const typingBaselineRef = useRef<DocBlock[] | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitTypingBaseline = () => {
    if (typingBaselineRef.current) {
      historyRef.current.past.push(typingBaselineRef.current);
      historyRef.current.future = [];
      typingBaselineRef.current = null;
    }
  };

  const noteTypingChange = (prevBlocks: DocBlock[]) => {
    if (!typingBaselineRef.current) typingBaselineRef.current = prevBlocks;
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(commitTypingBaseline, 600);
  };

  const commitStructural = (prevBlocks: DocBlock[]) => {
    commitTypingBaseline();
    historyRef.current.past.push(prevBlocks);
    historyRef.current.future = [];
    if (historyRef.current.past.length > 100) historyRef.current.past.shift();
  };

  const undo = () => {
    if (typingBaselineRef.current) {
      const restored = typingBaselineRef.current;
      typingBaselineRef.current = null;
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      historyRef.current.future.push(blocks);
      onChange({ blocks: restored });
      return;
    }
    const prev = historyRef.current.past.pop();
    if (!prev) return;
    historyRef.current.future.push(blocks);
    onChange({ blocks: prev });
  };

  const redo = () => {
    const next = historyRef.current.future.pop();
    if (!next) return;
    historyRef.current.past.push(blocks);
    onChange({ blocks: next });
  };

  // ── Block mutations (all by id, never by array position) ──────────────
  const setBlockTextTyping = (id: string, text: string) => {
    noteTypingChange(blocks);
    onChange({ blocks: blocks.map((b) => (b.id === id ? { ...b, text } : b)) });
  };

  const setBlockTextImmediate = (id: string, text: string) => {
    commitStructural(blocks);
    onChange({ blocks: blocks.map((b) => (b.id === id ? { ...b, text } : b)) });
  };

  const setBlockType = (id: string, type: DocBlock["type"]) => {
    commitStructural(blocks);
    onChange({ blocks: blocks.map((b) => (b.id === id ? { ...b, type } : b)) });
  };

  // Splits the block at `id` into two: `beforeHtml` stays in place, a new
  // block right after it gets `afterHtml`. This is what Enter actually
  // calls — see the onKeyDown handler above, which already extracted
  // "before"/"after" from the live DOM at the caret.
  //
  // lastSplitAtRef guards against a single Enter press producing two
  // blank-line splits (confirmed happening — a saved doc had a genuine
  // empty block where the user pressed Enter once). Two real, separate
  // paragraph breaks are never <80ms apart for an actual human keypress,
  // so anything that close is almost certainly a duplicate/bounced event
  // rather than intentional.
  const splitBlock = (
    id: string,
    beforeHtml: string,
    afterHtml: string,
    type: DocBlock["type"] = "p",
  ) => {
    const now = Date.now();
    if (now - lastSplitAtRef.current < 80) return;
    lastSplitAtRef.current = now;
    commitStructural(blocks);
    const index = blocks.findIndex((b) => b.id === id);
    if (index === -1) return;
    const newBlock: DocBlock = { id: makeId(), type, text: afterHtml };
    const next = [...blocks];
    next[index] = { ...next[index], text: beforeHtml };
    next.splice(index + 1, 0, newBlock);
    onChange({ blocks: next });
    // setTimeout(0), not requestAnimationFrame — more reliable for
    // focusing a node React just inserted; rAF can fire a tick before the
    // browser considers the new node's layout fully settled.
    setTimeout(() => refs.current.get(newBlock.id)?.focusAtStart(), 0);
  };

  const pasteLines = (id: string, beforeCaret: string, afterCaret: string, lines: string[]) => {
    commitStructural(blocks);
    const index = blocks.findIndex((b) => b.id === id);
    if (index === -1) return;
    const target = blocks[index];
    const newBlocks: DocBlock[] = lines.map((line, i) => {
      let text = escapeHtml(line);
      if (i === 0) text = escapeHtml(beforeCaret) + text;
      if (i === lines.length - 1) text = text + escapeHtml(afterCaret);
      return { id: i === 0 ? target.id : makeId(), type: target.type, text };
    });
    const next = [...blocks];
    next.splice(index, 1, ...newBlocks);
    onChange({ blocks: next });
    const lastId = newBlocks[newBlocks.length - 1].id;
    const caretOffsetInLast = lines[lines.length - 1].length;
    setTimeout(() => {
      const el = refs.current.get(lastId)?.getElement();
      if (el) {
        el.focus({ preventScroll: true });
        setCaretAtTextOffset(el, caretOffsetInLast);
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }, 0);
  };

  const removeBlock = (id: string) => {
    commitStructural(blocks);
    if (blocks.length === 1) {
      onChange({ blocks: [{ id: makeId(), type: "p", text: "" }] });
      return;
    }
    const index = blocks.findIndex((b) => b.id === id);
    if (index === -1) return;
    const next = blocks.filter((b) => b.id !== id);
    const focusId = next[Math.max(0, index - 1)]?.id;
    onChange({ blocks: next });
    setTimeout(() => {
      if (focusId) refs.current.get(focusId)?.focusAtEnd();
    }, 0);
  };

  const mergeIntoPrevious = (id: string) => {
    const index = blocks.findIndex((b) => b.id === id);
    if (index <= 0) return;
    commitStructural(blocks);
    const prev = blocks[index - 1];
    const current = blocks[index];
    const mergeBoundary = plainTextLength(prev.text);
    const next = blocks
      .map((b) => (b.id === prev.id ? { ...b, text: prev.text + current.text } : b))
      .filter((b) => b.id !== current.id);
    onChange({ blocks: next });
    setTimeout(() => {
      const el = refs.current.get(prev.id)?.getElement();
      if (el) {
        el.focus({ preventScroll: true });
        setCaretAtTextOffset(el, mergeBoundary);
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }, 0);
  };

  // ── Floating format toolbar on text selection ──────────────────────────
  const [toolbar, setToolbar] = useState<{ top: number; left: number; blockId: string } | null>(null);

  useEffect(() => {
    function handleSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setToolbar(null);
        return;
      }
      const range = sel.getRangeAt(0);
      let foundId: string | null = null;
      refs.current.forEach((handle, id) => {
        const el = handle.getElement();
        if (el && el.contains(range.startContainer) && el.contains(range.endContainer)) {
          foundId = id;
        }
      });
      if (foundId === null) {
        setToolbar(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setToolbar(null);
        return;
      }
      setToolbar({ top: rect.top, left: rect.left + rect.width / 2, blockId: foundId });
    }
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  const applyFormat = (command: "bold" | "italic") => {
    if (!toolbar) return;
    refs.current.get(toolbar.blockId)?.applyFormat(command);
  };

  return (
    <div
      className="flex flex-col"
      onKeyDown={(e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;
        const key = e.key.toLowerCase();
        if (key === "z" && e.shiftKey) {
          e.preventDefault();
          redo();
        } else if (key === "z") {
          e.preventDefault();
          undo();
        } else if (key === "y") {
          e.preventDefault();
          redo();
        }
      }}
    >
      {blocks.map((block) => (
        <BlockRow
          key={block.id}
          ref={(handle) => {
            if (handle) refs.current.set(block.id, handle);
            else refs.current.delete(block.id);
          }}
          block={block}
          onTextChange={(text) => setBlockTextTyping(block.id, text)}
          onFormatChange={(text) => setBlockTextImmediate(block.id, text)}
          onTypeChange={(type) => setBlockType(block.id, type)}
          onEnter={(before, after) =>
            splitBlock(block.id, before, after, block.type === "bullet" ? "bullet" : "p")
          }
          onBackspaceAtStart={() =>
            plainTextLength(block.text) === 0 ? removeBlock(block.id) : mergeIntoPrevious(block.id)
          }
          onPasteLines={(before, after, lines) => pasteLines(block.id, before, after, lines)}
        />
      ))}

      {toolbar && (
        <div
          className="fixed flex items-center gap-0.5"
          style={{
            top: toolbar.top - 40,
            left: toolbar.left,
            transform: "translateX(-50%)",
            background: "#2C2C2F",
            border: "1px solid #36363A",
            borderRadius: 8,
            padding: 4,
            zIndex: 30,
          }}
        >
          <button
            type="button"
            aria-label="Bold"
            onMouseDown={(e) => {
              e.preventDefault();
              applyFormat("bold");
            }}
            className="flex items-center justify-center rounded transition-colors"
            style={{ width: 26, height: 26, background: "transparent", border: "none", cursor: "pointer", color: "#E4E4E7" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#3A3A3E")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Bold size={13} />
          </button>
          <button
            type="button"
            aria-label="Italic"
            onMouseDown={(e) => {
              e.preventDefault();
              applyFormat("italic");
            }}
            className="flex items-center justify-center rounded transition-colors"
            style={{ width: 26, height: 26, background: "transparent", border: "none", cursor: "pointer", color: "#E4E4E7" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#3A3A3E")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Italic size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
