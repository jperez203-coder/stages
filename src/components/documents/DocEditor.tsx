"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ExternalLink, Heading1, Heading2, Link2Off, Pencil, Pilcrow, Plus, Square, X } from "lucide-react";
import { ToolbarBoldIcon, ToolbarBulletListIcon, ToolbarItalicIcon, ToolbarLinkIcon, ToolbarUnderlineIcon } from "@/components/icons/DocToolbarIcons";

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

// `color` only applies to "banner" blocks — a solid-color block with an
// editable header line (no image; see BlockRow's banner branch). Optional
// rather than a separate variant type so DocBlock stays one flat shape.
export type DocBlock = { id: string; type: "p" | "h1" | "h2" | "bullet" | "banner"; text: string; color?: string };
export type DocContent = { blocks: DocBlock[] };

function makeId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

// iconSize: each glyph fills a different share of its box, so sizes are
// set per icon to render every toolbar icon ~13px tall (the B's height) —
// measured from a screenshot, 2026-09-26.
const BLOCK_TYPES: {
  type: DocBlock["type"];
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  iconSize: number;
  label: string;
}[] = [
  { type: "p", icon: Pilcrow, iconSize: 16, label: "Text" },
  { type: "h1", icon: Heading1, iconSize: 22, label: "Heading 1" },
  { type: "h2", icon: Heading2, iconSize: 22, label: "Heading 2" },
  { type: "bullet", icon: ToolbarBulletListIcon, iconSize: 22, label: "Bullet" },
];

// Own palette rather than reusing STAGE_COLORS from lib/constants — that
// array also drives pipeline stage color assignment, so a banner-specific
// tweak (Jordan wanted a different green: #2A8C5E) would otherwise have
// shifted stage colors everywhere else too.
const BANNER_COLORS = [
  "#3BA5EE", "#8B5CF6", "#EC4899", "#F59E0B",
  "#2A8C5E", "#06B6D4", "#F43F5E", "#3B82F6",
  "#A855F7", "#14B8A6", "#EAB308", "#EF4444",
];

/** "page" = the Docs pages' Notion-style scale (16px body on a 24px line,
 *  30/24px headings with their own line boxes + space above them).
 *  "compact" = the original dense scale, still used by the task detail
 *  panel's body. */
export type DocScale = "page" | "compact";

function blockStyle(type: DocBlock["type"], scale: DocScale): React.CSSProperties {
  if (scale === "compact") {
    switch (type) {
      case "h1":
        return { fontSize: 26, fontWeight: 700, lineHeight: "22px", color: "#E4E4E7" };
      case "h2":
        return { fontSize: 19, fontWeight: 600, lineHeight: "22px", color: "#E4E4E7" };
      default:
        return { fontSize: 14, fontWeight: 400, lineHeight: "22px", color: "#E4E4E7" };
    }
  }
  switch (type) {
    case "h1":
      return { fontSize: 30, fontWeight: 600, lineHeight: "38px", letterSpacing: "-0.015em", color: "#F4F4F5" };
    case "h2":
      return { fontSize: 24, fontWeight: 600, lineHeight: "31px", letterSpacing: "-0.01em", color: "#F4F4F5" };
    default:
      return { fontSize: 16, fontWeight: 400, lineHeight: "24px", color: "#E4E4E7" };
  }
}

/** Line-box height in px for a block — drives minHeight, the bullet dot
 *  and vertical centering of the hover "+" gutter button. */
function blockLineHeight(type: DocBlock["type"], scale: DocScale): number {
  return parseInt(String(blockStyle(type, scale).lineHeight), 10);
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

/** Only these link schemes are ever saved or opened — blocks
 *  `javascript:` / `data:` style links that could run code. */
const SAFE_LINK = /^(https?:|mailto:|tel:)/i;

export function isSafeLinkHref(href: string | null | undefined): boolean {
  return !!href && SAFE_LINK.test(href.trim());
}

/** "stages.app" → "https://stages.app", "a@b.com" → "mailto:a@b.com".
 *  Returns null for empty or disallowed input. */
export function normalizeLinkInput(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return SAFE_LINK.test(v) ? v : null;
  if (/^[^\s@/]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (/\s/.test(v)) return null;
  return `https://${v.replace(/^\/+/, "")}`;
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

/** Screen rect of the collapsed caret, or null when the browser can't
 *  measure it (e.g. an empty line) — callers fall back to the block rect. */
function caretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0).cloneRange();
  r.collapse(true);
  const rects = r.getClientRects();
  const rect = rects.length ? rects[rects.length - 1] : r.getBoundingClientRect();
  return rect && (rect.width || rect.height) ? rect : null;
}

/** Is the caret on the first (up) / last (down) visual line of `el`? */
function isCaretOnEdgeLine(el: HTMLElement, dir: "up" | "down"): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const rect = caretRect();
  if (!rect) return true; // empty/unmeasurable line = the only line
  const box = el.getBoundingClientRect();
  const line = parseFloat(getComputedStyle(el).lineHeight) || rect.height || 20;
  return dir === "up" ? rect.top - box.top < line * 0.75 : box.bottom - rect.bottom < line * 0.75;
}

/** Put the caret in `el` at horizontal position `x`, on its first line
 *  (arriving from above) or last line (arriving from below). */
function placeCaretAtX(el: HTMLElement, x: number, from: "above" | "below") {
  el.focus({ preventScroll: true });
  const box = el.getBoundingClientRect();
  const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
  const y = from === "above" ? box.top + Math.min(line / 2, box.height / 2) : box.bottom - Math.min(line / 2, box.height / 2);
  const cx = Math.min(Math.max(x, box.left + 1), box.right - 1);
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let range: Range | null = null;
  if (typeof document.caretRangeFromPoint === "function") {
    range = document.caretRangeFromPoint(cx, y);
  } else if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(cx, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
    }
  }
  const sel = window.getSelection();
  if (range && el.contains(range.startContainer)) {
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
  } else {
    setCaretAtTextOffset(el, from === "above" ? 0 : plainTextLength(el.innerHTML));
  }
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
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
  let sawAnyTextNode = false;
  while ((node = walker.nextNode())) {
    sawAnyTextNode = true;
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
  // No text node satisfied the requested offset. Two different cases land
  // here: (a) the element has some text but the offset ran past all of it
  // (focusAtEnd's normal path) — collapsing to the end is correct there;
  // (b) the element has NO text nodes at all — e.g. backspacing the last
  // character often leaves a lone <br> behind instead of an empty node,
  // so the walker finds nothing even though the only sane caret position
  // is the start. Collapsing to the end in case (b) was the bug: it put
  // the visible caret past the <br>, which against a same-line CSS
  // placeholder read as "caret at the end of the placeholder text".
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!sawAnyTextNode);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

type BlockRowHandle = {
  focusAtStart: () => void;
  focusAtEnd: () => void;
  applyFormat: (command: "bold" | "italic" | "underline") => void;
  /** Link (or, with href=null, unlink) the text in `range`. */
  applyLink: (range: Range, href: string | null) => void;
  getElement: () => HTMLDivElement | null;
};

const BlockRow = forwardRef<
  BlockRowHandle,
  {
    block: DocBlock;
    onTextChange: (html: string) => void;
    onFormatChange: (html: string) => void;
    onEnter: (beforeCaretHtml: string, afterCaretHtml: string) => void;
    onBackspaceAtStart: () => void;
    onPasteLines: (beforeCaret: string, afterCaret: string, lines: string[]) => void;
    placeholder: string;
    /** Banner-only: change its color / remove it entirely. */
    onColorChange: (color: string) => void;
    onRemoveBanner: () => void;
    /** Per-line "+" gutter button (hover-only) — opens the insert menu
     *  anchored to whichever line it was clicked on. */
    onRequestPlus: (blockId: string, anchor: HTMLElement) => void;
    /** A link inside this block was clicked (caret placed, no selection). */
    onLinkClick: (a: HTMLAnchorElement) => void;
    /** Up/Down pressed on this block's first/last visual line — move to
     *  the neighbouring block at horizontal position `x`. Returns false
     *  when there's no block in that direction. */
    onVerticalArrow: (dir: "up" | "down", x: number) => boolean;
    /** Extra top margin, in px — used ONLY for the block right after a
     *  banner (see DocEditor's render). Zero everywhere else so normal
     *  block spacing is untouched. */
    spacingBefore: number;
    scale: DocScale;
  }
>(function BlockRow(
  {
    block,
    onTextChange,
    onFormatChange,
    onEnter,
    onBackspaceAtStart,
    onPasteLines,
    placeholder,
    onColorChange,
    onRemoveBanner,
    onRequestPlus,
    onLinkClick,
    onVerticalArrow,
    spacingBefore,
    scale,
  },
  ref,
) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const lastSynced = useRef<string | null>(null);
  const [showPalette, setShowPalette] = useState(false);

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
    applyLink(range, href) {
      const el = divRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      if (href) {
        document.execCommand("createLink", false, href);
        el.querySelectorAll("a").forEach((a) => {
          a.setAttribute("target", "_blank");
          a.setAttribute("rel", "noopener noreferrer");
        });
      } else {
        // Unlink the whole link the selection sits in, not just the
        // selected characters.
        const a = (range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement
        )?.closest("a");
        if (a && el.contains(a)) {
          const r = document.createRange();
          r.selectNodeContents(a);
          sel?.removeAllRanges();
          sel?.addRange(r);
        }
        document.execCommand("unlink");
      }
      sel?.collapseToEnd();
      const html = el.innerHTML;
      lastSynced.current = html;
      onFormatChange(html);
    },
    getElement() {
      return divRef.current;
    },
  }));

  const isEmpty = plainTextLength(block.text) === 0;

  // Per-line "+" — hover-only, sits in the gutter to the left of every
  // block (not just the first). Opens DocEditor's insert menu anchored
  // to this exact line. Absolutely positioned (not a flex sibling) so its
  // reserved layout space doesn't push the actual text right of where the
  // title sits — a flex gap here shifted every line's text ~26px off the
  // title's left edge even while the button was invisible (opacity:0
  // still occupies its box).
  const plusGutter = (
    <button
      type="button"
      contentEditable={false}
      onClick={(e) => onRequestPlus(block.id, e.currentTarget)}
      aria-label="Add content"
      className="flex items-center justify-center rounded transition-colors opacity-0 group-hover:opacity-100"
      style={{ position: "absolute", left: -26, top: Math.max(1, (blockLineHeight(block.type, scale) - 20) / 2 + (scale === "page" ? 2 : 0)), width: 20, height: 20, background: "transparent", border: "none", color: "#71717A", cursor: "pointer" }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "#E4E4E7")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "#71717A")}
    >
      <Plus size={15} />
    </button>
  );

  if (block.type === "banner") {
    const color = block.color ?? BANNER_COLORS[0];
    return (
      <div className="group" style={{ position: "relative", marginTop: spacingBefore }}>
        {plusGutter}
        <div contentEditable={false}>
          <div
            className="group/banner"
            style={{ position: "relative", borderRadius: 8, padding: "10px 20px", background: color }}
          >
            <input
              value={block.text}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder="Header"
              className="w-full outline-none"
              style={{ background: "transparent", border: "none", color: "#FFFFFF", fontSize: 16, padding: 0, fontFamily: "inherit" }}
            />
            <div
              className="flex items-center gap-1 opacity-0 group-hover/banner:opacity-100 transition-opacity"
              style={{ position: "absolute", top: 8, right: 8 }}
            >
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setShowPalette((v) => !v)}
                  aria-label="Change banner color"
                  className="flex items-center justify-center rounded"
                  style={{ width: 24, height: 24, background: "rgba(0,0,0,0.15)", border: "none", cursor: "pointer" }}
                >
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#0A0A0B", opacity: 0.4 }} />
                </button>
                {showPalette && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      right: 0,
                      zIndex: 10,
                      display: "grid",
                      gridTemplateColumns: "repeat(6, 1fr)",
                      gap: 6,
                      padding: 8,
                      background: "#18181B",
                      border: "1px solid #2D2E30",
                      borderRadius: 8,
                      boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
                    }}
                  >
                    {BANNER_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          onColorChange(c);
                          setShowPalette(false);
                        }}
                        aria-label={`Set banner color ${c}`}
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: c,
                          border: c === color ? "2px solid white" : "none",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={onRemoveBanner}
                aria-label="Remove banner"
                className="flex items-center justify-center rounded"
                style={{ width: 24, height: 24, background: "rgba(0,0,0,0.15)", border: "none", color: "#0A0A0B", cursor: "pointer" }}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group" style={{ position: "relative", marginTop: spacingBefore }}>
      {/* The per-block hover toolbar (Paragraph/H1/H2/Bullet) that used to
          float here on every line's hover was removed — it popped up
          constantly while reading/scanning text and got in the way rather
          than helping. Those same block-type controls now live in the
          selection-triggered Bold/Italic toolbar below (only appears when
          you've actually selected text), alongside onTypeChange still
          wired the same way via DocEditor's setBlockType. */}
      {plusGutter}
      <div className="flex items-start gap-1.5" style={scale === "page" ? { paddingBlock: 2 } : undefined}>
        {block.type === "bullet" && (
          <span contentEditable={false} style={{ color: "#71717A", fontSize: blockStyle("bullet", scale).fontSize, lineHeight: blockStyle("bullet", scale).lineHeight, flexShrink: 0 }}>•</span>
        )}
        <div
          ref={divRef}
          data-doc-block={block.id}
          contentEditable
          suppressContentEditableWarning
          // Browser spellcheck (red squiggles under misspelled words).
          spellCheck
          data-placeholder={block.type === "p" ? placeholder : ""}
          onClick={(e) => {
            // Google Docs-style: clicking linked text keeps the caret there
            // and shows a small card (Open / Edit / Remove) — see DocEditor.
            const a = (e.target as Element).closest("a");
            if (!a) return;
            e.preventDefault(); // never navigate from inside the editor
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed) return;
            onLinkClick(a as HTMLAnchorElement);
          }}
          onMouseUp={() => {
            // Empty contentEditable divs have no real text to click
            // against, so browsers place the visible caret at the click's
            // X position instead of snapping it to the only real offset
            // (0) — against a placeholder that reads as a full line of
            // text, that looks like the caret landed at the END instead
            // of the start. Force it back to the real (only) position
            // after the native click has already run.
            if (isEmpty) {
              const el = divRef.current;
              if (el) setCaretAtTextOffset(el, 0);
            }
          }}
          onInput={(e) => {
            const el = e.currentTarget;
            let html = el.innerHTML;
            if (html !== "" && plainTextLength(html) === 0) {
              // Backspacing the last character out usually leaves a stray
              // <br> (or similar empty node) behind instead of a truly
              // empty element. That lone node is what makes the browser
              // paint the caret at the END of the CSS placeholder instead
              // of the start — confirmed by testing: a genuinely empty
              // div (innerHTML === "") renders the caret at the true
              // start every time, but one containing just a <br> doesn't.
              // Clearing it fully makes "just deleted everything" look
              // and behave identically to "never typed anything".
              el.innerHTML = "";
              html = "";
            }
            lastSynced.current = html;
            onTextChange(html);
            if (html === "") setCaretAtTextOffset(el, 0);
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
            } else if (
              (e.key === "ArrowUp" || e.key === "ArrowDown") &&
              !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey
            ) {
              // Each block is its own editing box, so the browser's own
              // Up/Down stops at the box edge (jumping to line start/end).
              // On the first/last visual line, hop to the next block instead.
              const dir = e.key === "ArrowUp" ? "up" : "down";
              const el = e.currentTarget;
              if (!isCaretOnEdgeLine(el, dir)) return;
              const x = caretRect()?.left ?? el.getBoundingClientRect().left;
              if (onVerticalArrow(dir, x)) e.preventDefault();
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
          style={{ ...blockStyle(block.type, scale), minHeight: blockLineHeight(block.type, scale), wordBreak: "break-word" }}
        />
      </div>
    </div>
  );
});

export type PlusMenuItem = {
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  onSelect: () => void;
};

/* Selection toolbar + its link popovers — styled after ClickUp's doc
   toolbar (measured from screenshots, 2026-09-26): #191919, #35353A outline,
   soft shadow, 30px buttons, ~19px soft-grey icons, dark dividers. */
const TB = {
  bg: "#191919",
  icon: "#B3B3B3",
  iconActive: "#FFFFFF",
  hover: "#2A2A2A",
  active: "#2A2A2A",
  divider: "#333333",
  border: "1px solid #35353A",
  shadow: "0 6px 20px rgba(0,0,0,0.5)",
};
const TB_BUTTON =
  "flex items-center justify-center rounded-md transition-colors text-[#B3B3B3] hover:bg-[#2A2A2A] hover:text-white";

export function DocEditor({
  content,
  onChange,
  placeholder = "Type something…",
  extraPlusMenuItems,
  scale = "page",
}: {
  content: DocContent;
  onChange: (next: DocContent) => void;
  /** Empty-paragraph placeholder text. Defaults to the Docs pages' copy;
   *  the task detail panel passes its own ("Write, press '/' for
   *  commands") to match its Figma spec without changing Docs. */
  placeholder?: string;
  /** Extra rows appended to the per-line "+" insert menu, after the
   *  always-present "Banner" option — e.g. the task panel adds "Upload
   *  file" / "Add link" here, routed back to its own attachments section.
   *  DocEditor stays ignorant of what these do; it just renders them and
   *  calls onSelect. */
  extraPlusMenuItems?: PlusMenuItem[];
  /** Type scale — see DocScale. Defaults to the Docs pages' "page" scale. */
  scale?: DocScale;
}) {
  // Stable id for the fallback empty block — makeId() must NOT be called
  // inline here, or every re-render while content.blocks is still []
  // (e.g. opening the "+" menu, a state update on THIS component) hands
  // out a fresh random id, silently orphaning anything that captured the
  // previous render's id (the "+" menu did exactly this: open menu →
  // re-render regenerates the id → "Banner" click's stored blockId no
  // longer matches any block → insertBanner's findIndex silently no-ops).
  const fallbackIdRef = useRef<string | null>(null);
  if (!fallbackIdRef.current) fallbackIdRef.current = makeId();
  const blocks = content.blocks.length ? content.blocks : [{ id: fallbackIdRef.current, type: "p" as const, text: "" }];
  const refs = useRef<Map<string, BlockRowHandle>>(new Map());
  const lastSplitAtRef = useRef(0);

  // Safety net for content saved BEFORE insertBanner started guaranteeing a
  // trailing paragraph (below) — a banner has no contentEditable area of
  // its own, so a doc/task ending on one had nowhere left to click or type
  // at all. Runs once per doc that actually ends this way; appending a
  // real "p" block makes the condition false on the next render.
  useEffect(() => {
    if (blocks.length > 0 && blocks[blocks.length - 1].type === "banner") {
      onChange({ blocks: [...blocks, { id: makeId(), type: "p", text: "" }] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

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

  const setBlockColor = (id: string, color: string) => {
    commitStructural(blocks);
    onChange({ blocks: blocks.map((b) => (b.id === id ? { ...b, color } : b)) });
  };

  // Inserts a banner block right after `afterId` — or, if that block is an
  // empty paragraph (the common case: clicking "+" on a blank line),
  // REPLACES it instead so you don't end up with a stray empty line sitting
  // above the banner. Multiple banners are allowed anywhere in the body;
  // there's no singleton slot anymore.
  const insertBanner = (afterId: string) => {
    commitStructural(blocks);
    const index = blocks.findIndex((b) => b.id === afterId);
    if (index === -1) return;
    const target = blocks[index];
    const newBlock: DocBlock = { id: makeId(), type: "banner", text: "", color: BANNER_COLORS[0] };
    const next = [...blocks];
    if (target.type === "p" && plainTextLength(target.text) === 0) {
      next[index] = newBlock;
    } else {
      next.splice(index + 1, 0, newBlock);
    }
    // A banner has no contentEditable text area of its own, so if it ends
    // up as the LAST block there'd be nowhere left to click/type below it
    // — the doc would just dead-end. Always keep a real empty paragraph
    // after a trailing banner so there's somewhere to continue typing.
    const bannerIdx = next.findIndex((b) => b.id === newBlock.id);
    if (bannerIdx === next.length - 1) {
      next.push({ id: makeId(), type: "p", text: "" });
    }
    onChange({ blocks: next });
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

  // Up/Down across blocks: find the nearest block with a text area in that
  // direction (banners have none — they're skipped) and land at the same x.
  const moveVertically = (fromId: string, dir: "up" | "down", x: number): boolean => {
    const index = blocks.findIndex((b) => b.id === fromId);
    if (index === -1) return false;
    const step = dir === "up" ? -1 : 1;
    for (let i = index + step; i >= 0 && i < blocks.length; i += step) {
      const el = refs.current.get(blocks[i].id)?.getElement();
      if (el) {
        placeCaretAtX(el, x, dir === "up" ? "below" : "above");
        return true;
      }
    }
    return false;
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
    if (prev.type === "banner") {
      // Backspacing into a banner removes it instead of merging plain text
      // into its colored header — merging doesn't make sense there, same
      // reasoning most block editors use for callouts.
      const next = blocks.filter((b) => b.id !== prev.id);
      onChange({ blocks: next });
      setTimeout(() => refs.current.get(current.id)?.focusAtStart(), 0);
      return;
    }
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
  // Link box opened from the toolbar's link button. Holds the text range to
  // link (focus moves into the URL input, so the live selection is gone).
  const [linkEditor, setLinkEditor] = useState<{
    top: number;
    left: number;
    blockId: string;
    range: Range;
    existingHref: string | null;
  } | null>(null);
  // Card shown after clicking a link: address + Open / Edit / Remove.
  const [linkPreview, setLinkPreview] = useState<{
    top: number;
    left: number;
    blockId: string;
    href: string;
    anchor: HTMLAnchorElement;
  } | null>(null);
  const linkPreviewRef = useRef<HTMLDivElement | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState(false);
  const linkEditorRef = useRef<HTMLDivElement | null>(null);

  const openLinkEditor = () => {
    const sel = window.getSelection();
    if (!toolbar || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0).cloneRange();
    const node = range.startContainer;
    const a = (node instanceof Element ? node : node.parentElement)?.closest("a");
    const existingHref = a?.getAttribute("href") ?? null;
    setLinkDraft(existingHref ?? "");
    setLinkError(false);
    setLinkEditor({ top: toolbar.top, left: toolbar.left, blockId: toolbar.blockId, range, existingHref });
    setToolbar(null);
  };

  const showLinkPreview = (blockId: string, a: HTMLAnchorElement) => {
    const rect = a.getBoundingClientRect();
    setLinkPreview({ top: rect.bottom + 6, left: rect.left, blockId, href: a.getAttribute("href") ?? "", anchor: a });
  };

  // Edit / Remove from the card act on the whole link.
  const linkRangeFor = (a: HTMLAnchorElement) => {
    const r = document.createRange();
    r.selectNodeContents(a);
    return r;
  };

  const editFromPreview = () => {
    if (!linkPreview) return;
    const { blockId, href, anchor } = linkPreview;
    const rect = anchor.getBoundingClientRect();
    setLinkPreview(null);
    setLinkDraft(href);
    setLinkError(false);
    setLinkEditor({
      top: rect.top,
      left: rect.left + rect.width / 2,
      blockId,
      range: linkRangeFor(anchor),
      existingHref: href,
    });
  };

  const removeFromPreview = () => {
    if (!linkPreview) return;
    const { blockId, anchor } = linkPreview;
    setLinkPreview(null);
    commitStructural(blocks);
    refs.current.get(blockId)?.applyLink(linkRangeFor(anchor), null);
  };

  useEffect(() => {
    if (!linkPreview) return;
    const onMouseDown = (e: MouseEvent) => {
      if (linkPreviewRef.current?.contains(e.target as Node)) return;
      setLinkPreview(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Shift" && e.key !== "Meta" && e.key !== "Control" && e.key !== "Alt") setLinkPreview(null);
    };
    const onScroll = () => setLinkPreview(null);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [linkPreview]);

  const closeLinkEditor = (restoreSelection: boolean) => {
    if (!linkEditor) return;
    const { blockId, range } = linkEditor;
    setLinkEditor(null);
    if (restoreSelection) {
      const el = refs.current.get(blockId)?.getElement();
      if (el) {
        el.focus({ preventScroll: true });
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  };

  const submitLink = (remove = false) => {
    if (!linkEditor) return;
    const href = remove ? null : normalizeLinkInput(linkDraft);
    if (!remove && !href) {
      setLinkError(true);
      return;
    }
    commitStructural(blocks);
    refs.current.get(linkEditor.blockId)?.applyLink(linkEditor.range, href);
    setLinkEditor(null);
  };

  useEffect(() => {
    if (!linkEditor) return;
    const onMouseDown = (e: MouseEvent) => {
      if (linkEditorRef.current?.contains(e.target as Node)) return;
      setLinkEditor(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [linkEditor]);

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

  const applyFormat = (command: "bold" | "italic" | "underline") => {
    if (!toolbar) return;
    refs.current.get(toolbar.blockId)?.applyFormat(command);
  };

  const toolbarBlock = toolbar ? blocks.find((b) => b.id === toolbar.blockId) : null;

  // ── Per-line "+" insert menu (Banner always, plus host-provided extras) ─
  const [plusMenu, setPlusMenu] = useState<{ blockId: string; top: number; left: number } | null>(null);
  const plusMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!plusMenu) return;
    // Containment check (does the click's real target land inside the
    // menu's DOM node?), not stopPropagation() on the menu's own
    // onMouseDown — that was the bug: a REAL click's mousedown reached
    // this listener and closed the menu (unmounting it) before the
    // matching "click" event could ever fire on a menu button, so
    // choosing "Banner" visually looked like it did nothing. This is the
    // same pattern DueDatePopover/PriorityPopover/StatusPopover/
    // AssigneesPopover already use successfully.
    const onMouseDown = (e: MouseEvent) => {
      if (plusMenuRef.current && plusMenuRef.current.contains(e.target as Node)) return;
      setPlusMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPlusMenu(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [plusMenu]);

  // ── Multi-line selection ───────────────────────────────────────────────
  // Every block is its own contentEditable, and browsers won't extend a
  // selection across separate editing hosts — so drag-selecting stopped at
  // one line and Cmd/Ctrl+A only selected the current line. Fix: while a
  // selection may span blocks, the wrapper itself becomes the single
  // editing host ("multi mode"):
  //  - mousedown on a block turns the wrapper editable so a native drag can
  //    run across lines; on mouseup, a selection inside ONE block goes
  //    straight back to normal per-block editing (focus + range restored).
  //  - Cmd/Ctrl+A selects every block.
  //  - While multi mode is on, the DOM is never edited natively (beforeinput
  //    is blocked); keys are applied to the block model instead: copy is
  //    native, cut/Backspace/Delete/typing/paste replace the selection,
  //    arrows/Escape collapse back to a caret.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const multiRef = useRef(false);

  const blockElFor = (node: Node | null): HTMLElement | null => {
    const el = node instanceof Element ? node : node?.parentElement;
    return (el?.closest("[data-doc-block]") as HTMLElement | null) ?? null;
  };

  const enterMulti = () => {
    const w = wrapperRef.current;
    if (!w || multiRef.current) return;
    multiRef.current = true;
    w.contentEditable = "true";
  };

  /** Leave multi mode; optionally put the caret/selection back into one
   *  block (re-focusing it so its own key handlers run again). */
  const exitMulti = (focusEl?: HTMLElement | null, range?: Range | null) => {
    const w = wrapperRef.current;
    if (!w || !multiRef.current) return;
    multiRef.current = false;
    w.removeAttribute("contenteditable");
    if (focusEl) {
      focusEl.focus({ preventScroll: true });
      if (range) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  };

  const selectAllBlocks = () => {
    const w = wrapperRef.current;
    if (!w) return;
    const els = Array.from(w.querySelectorAll<HTMLElement>("[data-doc-block]"));
    if (!els.length) return;
    enterMulti();
    w.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(els[0], 0);
    const last = els[els.length - 1];
    range.setEnd(last, last.childNodes.length);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  /** Replace the current (multi-block) selection with `lines` (plain text;
   *  [] = just delete). The first and last touched blocks keep the text
   *  outside the selection and merge; everything between is removed. */
  const replaceSelection = (lines: string[]) => {
    const sel = window.getSelection();
    const w = wrapperRef.current;
    if (!sel || sel.rangeCount === 0 || !w) return;
    const range = sel.getRangeAt(0);
    const els = Array.from(w.querySelectorAll<HTMLElement>("[data-doc-block]"));
    const idxOfEl = (el: HTMLElement | null) => (el ? blocks.findIndex((b) => b.id === el.dataset.docBlock) : -1);
    const startEl = blockElFor(range.startContainer);
    const endEl = blockElFor(range.endContainer);
    // Boundaries outside any text block (a banner, the gutter) snap to the
    // nearest text block inside the range.
    const firstInside = els.find((el) => range.intersectsNode(el)) ?? null;
    const lastInside = [...els].reverse().find((el) => range.intersectsNode(el)) ?? null;
    const aEl = startEl ?? firstInside;
    const bEl = endEl ?? lastInside;
    if (!aEl || !bEl) return;
    let i = idxOfEl(aEl);
    const j = idxOfEl(bEl);
    if (i === -1 || j === -1) return;
    // Banners fully inside the selection are removed too.
    while (i > 0 && blocks[i - 1].type === "banner" && range.intersectsNode(w.children[i - 1] ?? w)) i--;
    const htmlOf = (r: Range) => {
      const div = document.createElement("div");
      div.appendChild(r.cloneContents());
      return div.innerHTML;
    };
    const before = document.createRange();
    before.selectNodeContents(aEl);
    if (startEl) before.setEnd(range.startContainer, range.startOffset);
    else before.collapse(true);
    const after = document.createRange();
    after.selectNodeContents(bEl);
    if (endEl) after.setStart(range.endContainer, range.endOffset);
    else after.collapse(false);
    const beforeHtml = htmlOf(before);
    const afterHtml = htmlOf(after);

    commitStructural(blocks);
    const first = blocks[i];
    const type: DocBlock["type"] = first.type === "banner" ? "p" : first.type;
    const pieces = lines.length ? lines : [""];
    const merged: DocBlock[] = pieces.map((line, k) => {
      let text = escapeHtml(line);
      if (k === 0) text = beforeHtml + text;
      if (k === pieces.length - 1) text = text + afterHtml;
      return { id: k === 0 ? first.id : makeId(), type, text };
    });
    const next = [...blocks];
    next.splice(i, j - i + 1, ...merged);
    onChange({ blocks: next });

    const target = merged[merged.length - 1];
    const caret =
      (pieces.length === 1 ? plainTextLength(beforeHtml) : 0) + pieces[pieces.length - 1].length;
    exitMulti();
    setTimeout(() => {
      const el = refs.current.get(target.id)?.getElement();
      if (el) {
        el.focus({ preventScroll: true });
        setCaretAtTextOffset(el, caret);
      }
    }, 0);
  };

  // Latest replaceSelection for the native listener below (it's registered
  // once, and replaceSelection closes over the current `blocks`).
  const replaceSelectionRef = useRef(replaceSelection);
  useEffect(() => {
    replaceSelectionRef.current = replaceSelection;
  });

  // Block native DOM edits while the wrapper is the editing host — React
  // owns the block DOM, so every change goes through the model instead.
  // Input that arrives without a keydown (dictation, autocorrect, IME,
  // "insert text" from assistive tools) is applied here.
  useEffect(() => {
    const w = wrapperRef.current;
    if (!w) return;
    const onBeforeInput = (e: InputEvent) => {
      if (!multiRef.current) return;
      e.preventDefault();
      const t = e.inputType;
      if (t === "insertFromPaste" || t === "insertFromDrop") return; // onPaste handles paste
      if (t.startsWith("delete") || t === "insertParagraph" || t === "insertLineBreak") {
        replaceSelectionRef.current([]);
      } else if (t.startsWith("insert") && e.data) {
        replaceSelectionRef.current(e.data.replace(/\r\n?/g, "\n").split("\n"));
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      if (multiRef.current && !w.contains(e.relatedTarget as Node | null)) exitMulti();
    };
    w.addEventListener("beforeinput", onBeforeInput);
    w.addEventListener("focusout", onFocusOut);
    return () => {
      w.removeEventListener("beforeinput", onBeforeInput);
      w.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  const handleMouseDownCapture = (e: React.MouseEvent) => {
    if (e.button !== 0 || e.shiftKey) return;
    // Only drags that start in a text block — banner inputs, the "+"
    // gutter and menus keep their normal behavior.
    if (!blockElFor(e.target as Node)) return;
    enterMulti();
    const onUp = () => {
      document.removeEventListener("mouseup", onUp);
      // Let the browser finish placing the selection first.
      setTimeout(() => {
        if (!multiRef.current) return;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return exitMulti();
        const range = sel.getRangeAt(0);
        const a = blockElFor(range.startContainer);
        const b = blockElFor(range.endContainer);
        if (a && a === b) exitMulti(a, range.cloneRange());
        // else: selection spans blocks — stay in multi mode.
      }, 0);
    };
    document.addEventListener("mouseup", onUp);
  };

  const handleMultiKeyDown = (e: React.KeyboardEvent): boolean => {
    if (!multiRef.current) return false;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && (key === "c" || key === "a")) {
      if (key === "a") {
        e.preventDefault();
        selectAllBlocks();
      }
      return true; // copy: native
    }
    if (mod && key === "x") {
      e.preventDefault();
      document.execCommand("copy");
      replaceSelection([]);
      return true;
    }
    if (mod) return false; // undo/redo etc. fall through
    if (e.key === "Backspace" || e.key === "Delete" || e.key === "Enter") {
      e.preventDefault();
      replaceSelection([]);
      return true;
    }
    if (e.key.length === 1 && !e.altKey) {
      e.preventDefault();
      replaceSelection([e.key]);
      return true;
    }
    if (e.key.startsWith("Arrow") || e.key === "Escape") {
      e.preventDefault();
      const sel = window.getSelection();
      const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      if (!range) return exitMulti(), true;
      const toStart = e.key === "ArrowLeft" || e.key === "ArrowUp";
      range.collapse(toStart);
      const el = blockElFor(range.startContainer);
      exitMulti(el, el ? range : null);
      return true;
    }
    return false;
  };

  return (
    <div
      ref={wrapperRef}
      className="flex flex-col outline-none"
      // Off on the wrapper itself (it only becomes editable during
      // multi-line selection); each text block turns spellcheck on.
      spellCheck={false}
      suppressContentEditableWarning
      onMouseDownCapture={handleMouseDownCapture}
      onCopy={(e) => {
        // Multi-line copy: one line of plain text per block (the native copy
        // adds blank lines between blocks and puts bullet dots on their own
        // line). Cut goes through here too (execCommand("copy")).
        if (!multiRef.current) return;
        const sel = window.getSelection();
        const w = wrapperRef.current;
        if (!sel || sel.rangeCount === 0 || !w) return;
        const range = sel.getRangeAt(0);
        const lines = Array.from(w.querySelectorAll<HTMLElement>("[data-doc-block]"))
          .filter((el) => range.intersectsNode(el))
          .map((el) => {
            const part = document.createRange();
            part.selectNodeContents(el);
            if (el.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset);
            if (el.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
            return part.toString();
          });
        e.preventDefault();
        e.clipboardData.setData("text/plain", lines.join("\n"));
      }}
      onPaste={(e) => {
        if (!multiRef.current) return;
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
        replaceSelection(text.split("\n"));
      }}
      onKeyDown={(e) => {
        // Text fields inside the editor (link box, banner title) keep their
        // own native shortcuts — Cmd+A there selects just that field.
        const t = e.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
        if (handleMultiKeyDown(e)) return;
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;
        if (e.key.toLowerCase() === "a") {
          e.preventDefault();
          selectAllBlocks();
          return;
        }
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
      {blocks.map((block, index) => (
        <BlockRow
          key={block.id}
          ref={(handle) => {
            if (handle) refs.current.set(block.id, handle);
            else refs.current.delete(block.id);
          }}
          block={block}
          onTextChange={(text) => setBlockTextTyping(block.id, text)}
          onFormatChange={(text) => setBlockTextImmediate(block.id, text)}
          // Bullets follow the Notion / Google Docs convention:
          //  - Enter on a bullet with text → new bullet below.
          //  - Enter on an EMPTY bullet (i.e. "double Enter") → that line
          //    turns back into a normal paragraph, ending the list.
          //  - Backspace at the start of a bullet → removes the bullet
          //    marker but keeps the text as a paragraph (a second Backspace
          //    then merges/deletes like any paragraph).
          onEnter={(before, after) => {
            if (block.type === "bullet" && plainTextLength(block.text) === 0) {
              setBlockType(block.id, "p");
              return;
            }
            splitBlock(block.id, before, after, block.type === "bullet" ? "bullet" : "p");
          }}
          onBackspaceAtStart={() => {
            if (block.type === "bullet") {
              setBlockType(block.id, "p");
              return;
            }
            if (plainTextLength(block.text) === 0) removeBlock(block.id);
            else mergeIntoPrevious(block.id);
          }}
          onPasteLines={(before, after, lines) => pasteLines(block.id, before, after, lines)}
          // Only the very first block of an otherwise-completely-empty doc
          // shows the placeholder — e.g. a brand-new blank page/task. Every
          // OTHER empty paragraph (a blank line used as a spacer between
          // sections in existing content, which this doc has plenty of)
          // stays silent instead of littering the page with "Type
          // something…" on every blank line.
          placeholder={index === 0 && blocks.length === 1 ? placeholder : ""}
          // Extra breathing room only right after a banner — everywhere
          // else, blocks stay zero-gap on purpose (see the "double
          // spacing" fix on regular Enter-created lines vs. wrapped text).
          // This targets specifically the banner→text adjacency, not
          // spacing in general.
          // In the "page" scale, headings also get Notion-style space
          // above them (never on the very first block).
          spacingBefore={
            index > 0 && blocks[index - 1].type === "banner"
              ? 10
              : scale === "page" && index > 0 && block.type === "h1"
                ? 24
                : scale === "page" && index > 0 && block.type === "h2"
                  ? 16
                  : 0
          }
          scale={scale}
          onLinkClick={(a) => showLinkPreview(block.id, a)}
          onVerticalArrow={(dir, x) => moveVertically(block.id, dir, x)}
          onColorChange={(color) => setBlockColor(block.id, color)}
          onRemoveBanner={() => removeBlock(block.id)}
          onRequestPlus={(blockId, anchor) => {
            const rect = anchor.getBoundingClientRect();
            setPlusMenu({ blockId, top: rect.bottom + 4, left: rect.left });
          }}
        />
      ))}

      {plusMenu && (
        <div
          ref={plusMenuRef}
          className="fixed flex flex-col"
          style={{
            top: plusMenu.top,
            left: plusMenu.left,
            width: 200,
            background: "#18181B",
            border: "1px solid #2D2E30",
            borderRadius: 12,
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
            padding: 6,
            zIndex: 30,
          }}
        >
          <button
            type="button"
            onClick={() => {
              insertBanner(plusMenu.blockId);
              setPlusMenu(null);
            }}
            className="flex items-center gap-2 w-full transition-colors"
            style={{ background: "transparent", border: "none", borderRadius: 6, padding: "7px 8px", cursor: "pointer", color: "#E4E4E7", fontSize: 13, textAlign: "left" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#26262A")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Square size={14} color="#71717A" />
            Banner
          </button>
          {(extraPlusMenuItems ?? []).map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                item.onSelect();
                setPlusMenu(null);
              }}
              className="flex items-center gap-2 w-full transition-colors"
              style={{ background: "transparent", border: "none", borderRadius: 6, padding: "7px 8px", cursor: "pointer", color: "#E4E4E7", fontSize: 13, textAlign: "left" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#26262A")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <item.icon size={14} color="#71717A" />
              {item.label}
            </button>
          ))}
        </div>
      )}

      {toolbar && (
        <div
          className="fixed flex items-center gap-px"
          style={{
            top: toolbar.top - 46,
            left: toolbar.left,
            transform: "translateX(-50%)",
            background: TB.bg,
            border: TB.border,
            borderRadius: 10,
            // 1px top/bottom (3px sides): 34px tall around the 30px buttons.
            padding: "1px 3px",
            zIndex: 30,
            boxShadow: TB.shadow,
          }}
        >
          {/* Block-type controls (Text/H1/H2/Bullet) — moved here from the
              old per-block hover toolbar, which popped up over every line
              on hover and got in the way of reading. Only shows now when
              text is actually selected. */}
          {BLOCK_TYPES.map(({ type, icon: Icon, iconSize, label }) => (
            <button
              key={type}
              type="button"
              title={label}
              onMouseDown={(e) => {
                e.preventDefault();
                if (toolbar) setBlockType(toolbar.blockId, type);
              }}
              className={TB_BUTTON}
              style={{
                width: 30,
                height: 30,
                border: "none",
                cursor: "pointer",
                ...(toolbarBlock?.type === type ? { background: TB.active, color: TB.iconActive } : null),
              }}
            >
              <Icon size={iconSize} strokeWidth={1.75} />
            </button>
          ))}

          <span aria-hidden style={{ width: 1, height: 20, margin: "0 6px", background: TB.divider, flexShrink: 0 }} />

          <button
            type="button"
            aria-label="Bold"
            onMouseDown={(e) => {
              e.preventDefault();
              applyFormat("bold");
            }}
            className={TB_BUTTON}
            style={{ width: 30, height: 30, border: "none", cursor: "pointer" }}
          >
            {/* The supplied B fills its whole box, so 13px renders it ~12px tall
                — level with the italic I, sized to ClickUp's toolbar. */}
            <ToolbarBoldIcon size={13} />
          </button>
          <button
            type="button"
            aria-label="Italic"
            onMouseDown={(e) => {
              e.preventDefault();
              applyFormat("italic");
            }}
            className={TB_BUTTON}
            style={{ width: 30, height: 30, border: "none", cursor: "pointer" }}
          >
            <ToolbarItalicIcon size={22} />
          </button>
          <button
            type="button"
            aria-label="Underline"
            onMouseDown={(e) => {
              e.preventDefault();
              applyFormat("underline");
            }}
            className={TB_BUTTON}
            style={{ width: 30, height: 30, border: "none", cursor: "pointer" }}
          >
            {/* Same visual height as the B (both supplied SVGs fill their box). */}
            <ToolbarUnderlineIcon size={13} />
          </button>
          <button
            type="button"
            aria-label="Link"
            title="Add link"
            onMouseDown={(e) => {
              e.preventDefault();
              openLinkEditor();
            }}
            className={TB_BUTTON}
            style={{ width: 30, height: 30, border: "none", cursor: "pointer" }}
          >
            {/* 14px → ~13px visible, the same height as the B and U. */}
            <ToolbarLinkIcon size={14} />
          </button>
        </div>
      )}

      {linkPreview && (
        <div
          ref={linkPreviewRef}
          contentEditable={false}
          className="fixed flex items-center gap-px"
          style={{
            top: linkPreview.top,
            left: linkPreview.left,
            background: TB.bg,
            border: TB.border,
            borderRadius: 10,
            padding: "3px 3px 3px 10px",
            zIndex: 31,
            boxShadow: TB.shadow,
            maxWidth: 380,
          }}
        >
          <span className="text-[13px] truncate" style={{ color: "#5AA7F5", maxWidth: 220 }} title={linkPreview.href}>
            {linkPreview.href.replace(/^(https?:\/\/|mailto:|tel:)/i, "")}
          </span>
          <span aria-hidden style={{ width: 1, height: 20, margin: "0 6px", background: TB.divider, flexShrink: 0 }} />
          {isSafeLinkHref(linkPreview.href) && (
            <a
              href={linkPreview.href}
              target="_blank"
              rel="noopener noreferrer"
              title="Open link"
              aria-label="Open link"
              onClick={() => setLinkPreview(null)}
              className={TB_BUTTON}
              style={{ width: 30, height: 30 }}
            >
              <ExternalLink size={16} strokeWidth={1.75} />
            </a>
          )}
          <button
            type="button"
            title="Edit link"
            aria-label="Edit link"
            onClick={editFromPreview}
            className={TB_BUTTON}
            style={{ width: 30, height: 30, border: "none", cursor: "pointer" }}
          >
            <Pencil size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title="Remove link"
            aria-label="Remove link"
            onClick={removeFromPreview}
            className={TB_BUTTON}
            style={{ width: 30, height: 30, border: "none", cursor: "pointer" }}
          >
            <Link2Off size={16} strokeWidth={1.75} />
          </button>
        </div>
      )}

      {linkEditor && (
        <div
          ref={linkEditorRef}
          contentEditable={false}
          className="fixed flex items-center gap-1.5"
          style={{
            top: linkEditor.top - 44,
            left: linkEditor.left,
            transform: "translateX(-50%)",
            background: TB.bg,
            border: TB.border,
            borderRadius: 10,
            padding: 3,
            zIndex: 31,
            boxShadow: TB.shadow,
          }}
        >
          <input
            autoFocus
            value={linkDraft}
            onChange={(e) => {
              setLinkDraft(e.target.value);
              setLinkError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeLinkEditor(true);
              }
            }}
            placeholder="Paste or type a link"
            aria-label="Link address"
            aria-invalid={linkError}
            className="outline-none text-[13px]"
            style={{
              width: 240,
              height: 28,
              padding: "0 8px",
              background: "#222222",
              border: `1px solid ${linkError ? "#F43F5E" : "#2E2E2E"}`,
              borderRadius: 6,
              color: "#E4E4E7",
            }}
          />
          <button
            type="button"
            onClick={() => submitLink()}
            className="rounded text-[12px] font-semibold"
            style={{ height: 28, padding: "0 10px", background: "#108CE9", border: "none", color: "#FFFFFF", cursor: "pointer" }}
          >
            {linkEditor.existingHref ? "Update" : "Add"}
          </button>
          {linkEditor.existingHref && (
            <button
              type="button"
              onClick={() => submitLink(true)}
              className="rounded-md text-[12px] font-semibold transition-colors hover:bg-[#2A2A2A]"
              style={{ height: 28, padding: "0 10px", border: "none", color: TB.icon, cursor: "pointer" }}
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}
