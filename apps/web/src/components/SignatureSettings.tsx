import { useState } from "react";
import { useAuth } from "../context/AuthContext";

export function SignatureSettings({ onClose }: { onClose: () => void }) {
  const { user, updateSignature } = useAuth();
  const [enabled, setEnabled] = useState(user?.signatureEnabled ?? true);
  const [name, setName] = useState(user?.signatureName ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateSignature({ signatureEnabled: enabled, signatureName: name.trim() || null });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="absolute right-0 top-full z-10 mt-2 w-72 rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
      <p className="mb-3 text-sm font-medium">Assinatura nas mensagens</p>
      <label className="mb-3 flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Ativar assinatura ao enviar mensagens
      </label>
      <label className="mb-1 block text-xs font-medium text-gray-500">Nome usado na assinatura</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={user?.name}
        disabled={!enabled}
        className="mb-3 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none disabled:bg-gray-50"
      />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50">
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Salvar
        </button>
      </div>
    </div>
  );
}
