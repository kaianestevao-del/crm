import { useEffect, useState } from "react";
import { api } from "../lib/api";

export interface WhatsappLabel {
  id: string;
  waLabelId: string;
  name: string;
  color: number | null;
}

export function ContactWhatsappLabels({
  contactId,
  labels,
  onChange,
}: {
  contactId: string;
  labels: WhatsappLabel[];
  onChange: (labels: WhatsappLabel[]) => void;
}) {
  const [allLabels, setAllLabels] = useState<WhatsappLabel[]>([]);
  const [open, setOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");

  useEffect(() => {
    if (open) api.get("/whatsapp-labels").then((res) => setAllLabels(res.data));
  }, [open]);

  async function addLabel(label: WhatsappLabel) {
    await api.post(`/contacts/${contactId}/whatsapp-labels`, { waLabelId: label.waLabelId });
    // Optimistic — WhatsApp's own confirmation event will reconcile shortly after via the
    // realtime "contact.updated" event, which refetches the real state anyway.
    if (!labels.some((l) => l.id === label.id)) onChange([...labels, label]);
  }

  async function removeLabel(label: WhatsappLabel) {
    await api.delete(`/contacts/${contactId}/whatsapp-labels/${label.waLabelId}`);
    onChange(labels.filter((l) => l.id !== label.id));
  }

  async function createLabel() {
    if (!newLabelName.trim()) return;
    await api.post("/whatsapp-labels", { name: newLabelName.trim() });
    setNewLabelName("");
    // The label doesn't exist in our DB until WhatsApp confirms it (labels.edit event), so
    // there's nothing to optimistically add here yet — just let the user know it's on its way.
  }

  const availableLabels = allLabels.filter((l) => !labels.some((selected) => selected.id === l.id));

  return (
    <div className="relative flex flex-wrap items-center gap-1">
      {labels.map((label) => (
        <span key={label.id} className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
          🏷️ {label.name}
          <button onClick={() => removeLabel(label)} className="text-emerald-800/60 hover:text-emerald-900">
            ×
          </button>
        </span>
      ))}
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50"
      >
        + Etiqueta do WhatsApp
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
          <div className="max-h-32 overflow-y-auto">
            {availableLabels.map((label) => (
              <button
                key={label.id}
                onClick={() => {
                  addLabel(label);
                  setOpen(false);
                }}
                className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-gray-50"
              >
                🏷️ {label.name}
              </button>
            ))}
            {availableLabels.length === 0 && (
              <p className="px-2 py-1 text-xs text-gray-400">Nenhuma etiqueta do WhatsApp disponível ainda.</p>
            )}
          </div>
          <div className="mt-1 flex gap-1 border-t border-gray-100 pt-1">
            <input
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              placeholder="Criar etiqueta nova..."
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-brand focus:outline-none"
            />
            <button
              onClick={() => {
                createLabel();
                setOpen(false);
              }}
              className="rounded-md bg-emerald-700 px-2 py-1 text-xs text-white hover:opacity-90"
            >
              Criar
            </button>
          </div>
          <p className="mt-1 px-1 text-[10px] text-gray-400">
            Criar etiqueta nova é experimental — se não aparecer em alguns segundos, crie pelo próprio WhatsApp.
          </p>
        </div>
      )}
    </div>
  );
}
