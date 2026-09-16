import { useEffect } from "react";

// Full-size view of a received/sent image, with an explicit download link — the inline
// thumbnail in MessageBubble has no zoom or download affordance of its own.
export function MediaLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 text-2xl text-white/80 hover:text-white"
        aria-label="Fechar"
      >
        ✕
      </button>
      <img
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
      />
      <a
        href={src}
        download
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-xl bg-white/90 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-white"
      >
        ⬇️ Baixar
      </a>
    </div>
  );
}
