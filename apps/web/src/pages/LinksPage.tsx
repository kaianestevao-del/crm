import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";

interface WhatsappSession {
  id: string;
  phoneNumber: string | null;
  status: string;
}

interface CustomLink {
  id: string;
  name: string;
  message: string;
}

function buildWaLink(phoneNumber: string, message: string) {
  return `https://wa.me/${phoneNumber}${message.trim() ? `?text=${encodeURIComponent(message.trim())}` : ""}`;
}

// A conexão Cloud API nem sempre traz o número preenchido automaticamente (depende de uma busca
// na Meta que pode falhar por permissão do token). Em vez de travar a geração de link nisso, o
// número fica configurável aqui manualmente e salvo neste navegador — independe do backend.
function loadPhoneOverride(sessionId: string): string {
  try {
    return localStorage.getItem(`wa-link-phone:${sessionId}`) ?? "";
  } catch {
    return "";
  }
}

function savePhoneOverride(sessionId: string, phoneNumber: string) {
  try {
    localStorage.setItem(`wa-link-phone:${sessionId}`, phoneNumber);
  } catch {
    // Storage unavailable — o número só não persiste entre recarregamentos.
  }
}

// Saved locally in the browser (no backend/DB involved) — one list of link presets per
// WhatsApp connection, so a person setting up multiple links (bio, ads, etc.) doesn't have to
// retype the message every time. Lives only on this device/browser.
function loadSavedLinks(sessionId: string): CustomLink[] {
  try {
    const raw = localStorage.getItem(`wa-custom-links:${sessionId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSavedLinks(sessionId: string, links: CustomLink[]) {
  try {
    localStorage.setItem(`wa-custom-links:${sessionId}`, JSON.stringify(links));
  } catch {
    // Storage unavailable (private mode, quota) — links just won't persist across reloads.
  }
}

function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — the link is still selectable/copyable from the input.
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="whitespace-nowrap rounded-xl bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
    >
      {copied ? "Copiado!" : "Copiar link"}
    </button>
  );
}

function WaLinkGenerator({ sessionId, defaultPhoneNumber }: { sessionId: string; defaultPhoneNumber: string }) {
  const [links, setLinks] = useState<CustomLink[]>(() => loadSavedLinks(sessionId));
  const [phoneNumber, setPhoneNumber] = useState(() => loadPhoneOverride(sessionId) || defaultPhoneNumber);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  function handlePhoneChange(value: string) {
    const digits = value.replace(/\D/g, "");
    setPhoneNumber(digits);
    savePhoneOverride(sessionId, digits);
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const next = [...links, { id: crypto.randomUUID(), name: name.trim(), message: message.trim() }];
    setLinks(next);
    saveSavedLinks(sessionId, next);
    setName("");
    setMessage("");
  }

  function handleDelete(id: string) {
    const next = links.filter((l) => l.id !== id);
    setLinks(next);
    saveSavedLinks(sessionId, next);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-4 space-y-1">
        <label className="text-xs font-medium text-gray-500">Número usado nos links</label>
        <div className="flex items-center overflow-hidden rounded-xl border border-gray-300 focus-within:border-brand">
          <span className="border-r border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-500">+</span>
          <input
            value={phoneNumber}
            onChange={(e) => handlePhoneChange(e.target.value)}
            placeholder="Ex: 5571966630936"
            className="w-full px-3 py-2 text-sm focus:outline-none"
          />
        </div>
        <p className="text-xs text-gray-400">DDI + DDD + número, só dígitos. Confirme/ajuste aqui se vier errado.</p>
      </div>

      <form onSubmit={handleCreate} className="mb-4 space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do link (ex: Bio do Instagram, Anúncio de setembro)"
          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Mensagem pré-preenchida (opcional)"
          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="rounded-xl bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Salvar link
        </button>
      </form>

      {links.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhum link salvo ainda.</p>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <li key={link.id} className="rounded-xl border border-gray-200 bg-gray-50 p-2.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-gray-700">{link.name}</p>
                <button onClick={() => handleDelete(link.id)} className="text-xs font-medium text-red-600 hover:underline">
                  Apagar
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={buildWaLink(phoneNumber, link.message)}
                  className="flex-1 truncate rounded-xl border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-600"
                />
                <CopyLinkButton link={buildWaLink(phoneNumber, link.message)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateContactForm() {
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!phoneNumber.trim()) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.post("/contacts", { name: name.trim() || undefined, phoneNumber: `55${phoneNumber.trim()}` });
      setSaved(true);
      setName("");
      setPhoneNumber("");
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Não foi possível salvar o contato. Confira o número e tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <form onSubmit={handleSubmit} className="space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do contato"
          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <div className="flex items-center overflow-hidden rounded-xl border border-gray-300 focus-within:border-brand">
          <span className="border-r border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-500">+55</span>
          <input
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ""))}
            placeholder="DDD + número, ex: 11999998888"
            className="w-full px-3 py-2 text-sm focus:outline-none"
          />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving || !phoneNumber.trim()}
            className="rounded-xl bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar contato"}
          </button>
          {saved && <span className="text-xs font-medium text-green-600">Contato salvo!</span>}
        </div>
      </form>
    </div>
  );
}

export function LinksPage() {
  const [session, setSession] = useState<WhatsappSession | null>(null);

  useEffect(() => {
    api.get("/whatsapp-sessions").then((res) => {
      const connected = (res.data as WhatsappSession[]).find((s) => s.status === "CONNECTED");
      setSession(connected ?? null);
    });
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <h1 className="mb-1 text-lg font-semibold text-gray-900">Links & Contatos</h1>
      <p className="mb-6 max-w-2xl text-sm text-gray-500">
        Crie links de WhatsApp com mensagem pronta para compartilhar (bio, anúncios, site) e salve contatos novos
        manualmente no CRM.
      </p>

      <div className="grid max-w-3xl gap-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-800">🔗 Criar link com mensagem</h2>
          {session ? (
            <WaLinkGenerator sessionId={session.id} defaultPhoneNumber={session.phoneNumber ?? ""} />
          ) : (
            <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
              Conecte um número em "Conexão WhatsApp" para gerar links.
            </p>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-800">👤 Salvar novo contato</h2>
          <CreateContactForm />
        </section>
      </div>
    </div>
  );
}
