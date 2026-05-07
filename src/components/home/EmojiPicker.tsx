"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

const EMOJI_CATEGORIES: Record<string, string[]> = {
  Recent: [],
  Smileys: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨","😐","😑","😶","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","😎","🤓","🧐"],
  People: ["👋","🤚","✋","🖖","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","✍️","💅","🤳","💪","🦵","🦶","👂","🦻","👃","🧠","🫀","🫁","🦷","🦴","👀","👁️","👅","👄","👶","🧒","👦","👧","🧑","👱","👨","🧔","👩","🧓","👴","👵"],
  "Animals & Nature": ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐽","🐸","🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦","🐤","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🪱","🐛","🦋","🐌","🐞","🐜","🪰","🪲","🦗","🕷️","🌵","🎄","🌲","🌳","🌴","🌱","🌿","☘️","🍀","🌾","🌺","🌻","🌹","🌷","🌸","💐","🍄","🐚","🪨","🌍","🌎","🌏","🌑","🌕","☀️","⭐","🌟","✨","⚡","🔥","💧","🌈"],
  "Food & Drink": ["🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶️","🫑","🌽","🥕","🫒","🧄","🧅","🥔","🍠","🥐","🥯","🍞","🥖","🥨","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🌭","🍔","🍟","🍕","🥪","🥙","🌮","🌯","🥗","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🍤","🍙","🍚","🍘","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯","🥛","🍼","☕","🫖","🍵","🥤","🍶","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🍾"],
  "Activity & Travel": ["⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🪀","🏓","🏸","🥅","⛳","🪁","🏹","🎣","🤿","🥊","🥋","🎽","🛹","🛼","🛷","⛸️","🥌","🎿","⛷️","🏂","🏋️","🤼","🤸","⛹️","🤺","🤾","🏌️","🏇","🧘","🏄","🏊","🤽","🚣","🧗","🚴","🚵","🎬","🎤","🎧","🎼","🎹","🥁","🎷","🎺","🎸","🪕","🎻","🎲","♟️","🎯","🎳","🎮","🎰","🧩","🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒","🚐","🛻","🚚","🚛","🚜","🛵","🏍️","🛺","🚲","🛴","🚨","🚍","🚘","🚖","🚡","🚠","🚟","🚃","🚋","🚞","🚝","🚄","🚅","🚈","🚂","🚆","🚇","🚊","🚉","✈️","🛫","🛬","🛩️","💺","🛰️","🚀","🛸","🚁","🛶","⛵","🚤","🛥️","🛳️","⛴️","🚢","⚓"],
  Objects: ["💡","🔦","🕯️","🪔","🧯","🛢️","💸","💵","💴","💶","💷","💰","💳","💎","⚖️","🪜","🧰","🪛","🔧","🔨","⚒️","🛠️","⛏️","🪚","🔩","⚙️","🪤","🧱","⛓️","🧲","🔫","💣","🧨","🪓","🔪","🗡️","⚔️","🛡️","🚬","⚰️","🪦","⚱️","🏺","🔮","📿","🧿","💈","⚗️","🔭","🔬","🕳️","🩹","🩺","💊","💉","🧬","🦠","🧫","🧪","🌡️","🧹","🧺","🧻","🚽","🚰","🚿","🛁","🧼","🪥","🪒","🧽","🪣","🧴","🛎️","🔑","🗝️","🚪","🪑","🛋️","🛏️","🛌","🧸","🪆","🖼️","🪞","🪟","🛍️","🛒","🎁","🎈","🎏","🎀","🪄","🪅","🎊","🎉","🪩","🎎","🏮","🎐","🧧","✉️","📩","📨","📧","💌","📥","📤","📦","🏷️","🪧","📪","📫","📬","📭","📮","📯","📜","📃","📄","📑","🧾","📊","📈","📉","🗒️","🗓️","📆","📅","🗑️","📇","🗃️","🗳️","🗄️","📋","📁","📂","🗂️","🗞️","📰","📓","📔","📒","📕","📗","📘","📙","📚","📖","🔖","🧷","🔗","📎","🖇️","📐","📏","🧮","📌","📍","✂️","🖊️","🖋️","✒️","🖌️","🖍️","📝","✏️","🔍","🔎","🔏","🔐","🔒","🔓"],
  Symbols: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","☮️","✝️","☪️","🕉️","☸️","✡️","🔯","🕎","☯️","☦️","🛐","⛎","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","🆔","⚛️","🉑","☢️","☣️","📴","📳","🈶","🈚","🈸","🈺","🈷️","✴️","🆚","💮","🉐","㊙️","㊗️","🈴","🈵","🈹","🈲","🅰️","🅱️","🆎","🆑","🅾️","🆘","❌","⭕","🛑","⛔","📛","🚫","💯","💢","♨️","🚷","🚯","🚳","🚱","🔞","📵","🚭","❗","❕","❓","❔","‼️","⁉️","🔅","🔆","〽️","⚠️","🚸","🔱","⚜️","🔰","♻️","✅","🈯","💹","❇️","✳️","❎","🌐","💠","Ⓜ️","🌀","💤","🏧","🚾","♿","🅿️","🛗","🈳","🈂️","🛂","🛃","🛄","🛅","🚹","🚺","🚼","⚧","🚻","🚮","🎦","📶","🈁","🔣","ℹ️","🔤","🔡","🔠","🆖","🆗","🆙","🆒","🆕","🆓","0️⃣","1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"],
  Flags: ["🏳️","🏴","🏁","🚩","🏳️‍🌈","🏳️‍⚧️","🏴‍☠️"],
};

const EMOJI_KEYWORDS: Record<string, string[]> = {
  "📋": ["clipboard", "list", "tasks"],
  "📊": ["chart", "stats", "data", "analytics"],
  "📈": ["chart", "growth", "up", "increase"],
  "📉": ["chart", "decline", "down", "decrease"],
  "💼": ["work", "business", "briefcase", "job"],
  "🎨": ["art", "design", "creative", "palette"],
  "🚀": ["rocket", "launch", "startup", "fast"],
  "💡": ["idea", "light", "bulb", "insight"],
  "🔥": ["fire", "hot", "trending"],
  "⭐": ["star", "favorite"],
  "✨": ["sparkles", "new", "magic"],
  "🎯": ["target", "goal", "focus", "aim"],
  "🏆": ["trophy", "win", "award"],
  "💰": ["money", "cash", "sales"],
  "📞": ["phone", "call", "contact"],
  "📧": ["email", "mail"],
  "📅": ["calendar", "date", "schedule"],
  "🛠️": ["tools", "build", "fix"],
  "🤝": ["handshake", "deal", "partner"],
};

const CATEGORY_LABELS: Record<string, string> = {
  Recent: "🕐",
  Smileys: "😀",
  People: "👋",
  "Animals & Nature": "🐶",
  "Food & Drink": "🍔",
  "Activity & Travel": "⚽",
  Objects: "💡",
  Symbols: "❤️",
  Flags: "🏳️",
};

type Props = {
  onPick: (emoji: string) => void;
  onClose: () => void;
};

export function EmojiPicker({ onPick }: Props) {
  const [activeCategory, setActiveCategory] = useState<string>("Smileys");
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      const r = window.localStorage?.getItem("stages_recent_emoji");
      if (r) setRecent(JSON.parse(r));
    } catch {}
  }, []);

  const handlePick = (emoji: string) => {
    const newRecent = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, 24);
    setRecent(newRecent);
    try {
      window.localStorage?.setItem("stages_recent_emoji", JSON.stringify(newRecent));
    } catch {}
    onPick(emoji);
  };

  const allEmoji = Object.values(EMOJI_CATEGORIES).flat();

  const q = search.trim().toLowerCase();
  let displayed: string[];
  if (q) {
    displayed = allEmoji.filter((e) => {
      const keywords = EMOJI_KEYWORDS[e] || [];
      return keywords.some((k) => k.includes(q));
    });
    if (displayed.length === 0) displayed = allEmoji;
  } else {
    displayed = activeCategory === "Recent" ? recent : EMOJI_CATEGORIES[activeCategory];
  }

  return (
    <div
      className="flex flex-col"
      style={{
        width: "340px",
        height: "400px",
        background: "#1A1A1A",
        border: "1px solid #36363A",
        borderRadius: "12px",
        boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
        overflow: "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="p-2 border-b border-zinc-800">
        <div className="relative">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search emoji..."
            className="w-full"
            style={{
              paddingLeft: "32px",
              paddingRight: "12px",
              height: "32px",
              fontSize: "13px",
              background: "#1A1A1C",
              border: "1px solid #36363A",
              borderRadius: "6px",
              color: "#E4E4E7",
              outline: "none",
            }}
          />
        </div>
      </div>

      {!q && (
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-zinc-800 overflow-x-auto scrollbar-thin">
          {Object.keys(EMOJI_CATEGORIES).map((cat) => {
            if (cat === "Recent" && recent.length === 0) return null;
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                title={cat}
                className="flex-shrink-0 transition-colors"
                style={{
                  width: "30px",
                  height: "30px",
                  background: isActive ? "#36363A" : "transparent",
                  borderRadius: "6px",
                  fontSize: "16px",
                  border: "none",
                  cursor: "pointer",
                  opacity: isActive ? 1 : 0.6,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "#1F1F22";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
        {displayed.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[12px] text-zinc-500">
            No emoji found
          </div>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {displayed.map((emoji, i) => (
              <button
                key={`${emoji}-${i}`}
                onClick={() => handlePick(emoji)}
                className="flex items-center justify-center transition-colors"
                style={{
                  width: "36px",
                  height: "36px",
                  background: "transparent",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "20px",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#36363A")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
