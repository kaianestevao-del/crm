import { useEffect, useRef } from "react";

// A curated set rather than a full emoji library — keeps the bundle light and covers what
// actually gets used in patient/attendant chat (reactions, common objects, no dependency).
const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Frequentes",
    emojis: ["😀", "😂", "😍", "🙏", "👍", "👏", "🙌", "❤️", "🔥", "🎉"],
  },
  {
    label: "Rostos",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🙂", "😉", "😊",
      "😍", "😘", "😗", "😋", "😎", "🤗", "🤔", "😐", "😴", "😢",
      "😭", "😡", "😱", "🥳", "🤒", "🤕", "😷", "🥰", "🤩", "😬",
    ],
  },
  {
    label: "Gestos",
    emojis: ["👍", "👎", "👏", "🙌", "🙏", "🤝", "💪", "✌️", "🤞", "👌", "✋", "👋"],
  },
  {
    label: "Saúde e comida",
    emojis: ["🍎", "🥗", "🥑", "💊", "🩺", "🏃", "🧘", "💧", "🍽️", "⚖️"],
  },
  {
    label: "Outros",
    emojis: ["✅", "❌", "⚠️", "📌", "📅", "⏰", "💬", "📷", "🎯", "⭐"],
  },
];

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 mb-2 h-72 w-72 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
    >
      {EMOJI_GROUPS.map((group) => (
        <div key={group.label} className="mb-2">
          <p className="mb-1 px-1 text-[11px] font-medium uppercase text-gray-400">{group.label}</p>
          <div className="grid grid-cols-8 gap-0.5">
            {group.emojis.map((emoji, i) => (
              <button
                key={`${emoji}-${i}`}
                type="button"
                onClick={() => onPick(emoji)}
                className="rounded text-lg leading-8 hover:bg-gray-100"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
