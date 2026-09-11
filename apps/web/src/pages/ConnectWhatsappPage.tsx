import { FormEvent, useEffect, useState } from "react";
import { SessionStatus } from "@crm/shared";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";

interface WhatsappSession {
  id: string;
  name: string;
  phoneNumber: string | null;
  status: SessionStatus;
  qrCode: string | null;
  pairingCode: string | null;
  provider: "BAILEYS" | "CLOUD_API";
}

const statusLabel: Record<SessionStatus, string> = {
  [SessionStatus.PENDING]: "Aguardando conexão",
  [SessionStatus.CONNECTED]: "Conectado",
  [SessionStatus.DISCONNECTED]: "Desconectado (tentando reconectar)",
  [SessionStatus.LOGGED_OUT]: "Desconectado (faça login novamente)",
};

const statusColor: Record<SessionStatus, string> = {
  [SessionStatus.PENDING]: "bg-yellow-100 text-yellow-800",
  [SessionStatus.CONNECTED]: "bg-green-100 text-green-800",
  [SessionStatus.DISCONNECTED]: "bg-orange-100 text-orange-800",
  [SessionStatus.LOGGED_OUT]: "bg-red-100 text-red-800",
};

function formatPairingCode(code: string) {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

interface CustomLink {
  id: string;
  name: string;
  message: string;
}

function buildWaLink(phoneNumber: string, message: string) {
  return `https://wa.me/${phoneNumber}${message.trim() ? `?text=${encodeURIComponent(message.trim())}` : ""}`;
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
      className="whitespace-nowrap rounded-xl bg-brand-dark px-2 py-1.5 text-xs font-medium text-white hover:opacity-90"
    >
      {copied ? "Copiado!" : "Copiar link"}
    </button>
  );
}

function WaLinkGenerator({ sessionId, phoneNumber }: { sessionId: string; phoneNumber: string }) {
  const [links, setLinks] = useState<CustomLink[]>(() => loadSavedLinks(sessionId));
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

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
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <form onSubmit={handleCreate} className="mb-3 space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do link (ex: Bio do Instagram, Anúncio de setembro)"
          className="w-full rounded-xl border border-gray-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none"
        />
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Mensagem pré-preenchida (opcional)"
          className="w-full rounded-xl border border-gray-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="rounded-xl bg-brand-dark px-2 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Salvar link
        </button>
      </form>

      {links.length === 0 ? (
        <p className="text-xs text-gray-400">Nenhum link salvo ainda para este número.</p>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <li key={link.id} className="rounded-xl border border-gray-200 bg-white p-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="truncate text-xs font-medium text-gray-700">{link.name}</p>
                <button onClick={() => handleDelete(link.id)} className="text-[10px] font-medium text-red-600 hover:underline">
                  Apagar
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={buildWaLink(phoneNumber, link.message)}
                  className="flex-1 truncate rounded-xl border border-gray-300 bg-gray-50 px-2 py-1.5 text-xs text-gray-600"
                />
                <CopyLinkButton link={buildWaLink(phoneNumber, link.message)} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[10px] text-gray-400">
        Salve um link por canal (bio, site, Instagram) para que qualquer pessoa abra uma conversa com este número no
        WhatsApp já com a mensagem certa preenchida. Os links ficam salvos neste navegador.
      </p>
    </div>
  );
}

function CloudApiCredentialsForm({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!accessToken.trim() && !appSecret.trim() && !phoneNumberId.trim()) return;
    setSaving(true);
    try {
      await api.patch(`/whatsapp-sessions/${sessionId}/cloud-api-credentials`, {
        cloudApiAccessToken: accessToken.trim() || undefined,
        cloudApiAppSecret: appSecret.trim() || undefined,
        cloudApiPhoneNumberId: phoneNumberId.trim() || undefined,
      });
      setAccessToken("");
      setAppSecret("");
      setPhoneNumberId("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="mt-3 space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <p className="text-xs font-medium text-gray-600">Atualizar credenciais da API Oficial</p>
      <p className="text-[10px] text-gray-400">
        Preencha só o que precisa trocar — o que ficar em branco continua com o valor salvo antes.
      </p>
      <input
        value={accessToken}
        onChange={(e) => setAccessToken(e.target.value)}
        placeholder="Novo Access Token"
        type="password"
        className="w-full rounded-xl border border-gray-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none"
      />
      <input
        value={appSecret}
        onChange={(e) => setAppSecret(e.target.value)}
        placeholder="Novo App Secret (opcional)"
        type="password"
        className="w-full rounded-xl border border-gray-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none"
      />
      <input
        value={phoneNumberId}
        onChange={(e) => setPhoneNumberId(e.target.value)}
        placeholder="Novo Phone Number ID (opcional)"
        className="w-full rounded-xl border border-gray-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none"
      />
      <div className="flex items-center justify-end gap-2">
        {saved && <span className="text-xs text-green-600">Salvo!</span>}
        <button type="button" onClick={onClose} className="px-2 py-1 text-xs text-gray-500 hover:underline">
          Fechar
        </button>
        <button
          type="submit"
          disabled={saving || (!accessToken.trim() && !appSecret.trim() && !phoneNumberId.trim())}
          className="rounded-xl bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Salvar
        </button>
      </div>
    </form>
  );
}

export function ConnectWhatsappPage() {
  const [sessions, setSessions] = useState<WhatsappSession[]>([]);
  const [newName, setNewName] = useState("");
  const [connectMethod, setConnectMethod] = useState<"qr" | "code" | "cloud">("qr");
  const [pairingPhoneNumber, setPairingPhoneNumber] = useState("");
  const [cloudPhoneNumberId, setCloudPhoneNumberId] = useState("");
  const [cloudAccessToken, setCloudAccessToken] = useState("");
  const [cloudAppSecret, setCloudAppSecret] = useState("");
  const [creating, setCreating] = useState(false);
  const [linkGeneratorFor, setLinkGeneratorFor] = useState<string | null>(null);
  const [credentialsFormFor, setCredentialsFormFor] = useState<string | null>(null);
  const [confirmDeleteFor, setConfirmDeleteFor] = useState<string | null>(null);
  const [cloudWebhookInfo, setCloudWebhookInfo] = useState<{ url: string; verifyToken: string } | null>(null);

  async function refresh() {
    const res = await api.get("/whatsapp-sessions");
    setSessions(res.data);
  }

  useEffect(() => {
    refresh();
    const socket = getSocket();
    if (!socket) return;

    const onQr = (evt: { sessionId: string; qr: string }) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === evt.sessionId ? { ...s, qrCode: evt.qr, pairingCode: null, status: SessionStatus.PENDING } : s)),
      );
    };
    const onPairingCode = (evt: { sessionId: string; pairingCode: string }) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === evt.sessionId ? { ...s, pairingCode: evt.pairingCode, qrCode: null, status: SessionStatus.PENDING } : s,
        ),
      );
    };
    const onStatus = (evt: { sessionId: string; status: SessionStatus; phoneNumber?: string | null }) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === evt.sessionId
            ? {
                ...s,
                status: evt.status,
                phoneNumber: evt.phoneNumber ?? s.phoneNumber,
                qrCode: evt.status === SessionStatus.CONNECTED ? null : s.qrCode,
                pairingCode: evt.status === SessionStatus.CONNECTED ? null : s.pairingCode,
              }
            : s,
        ),
      );
    };

    socket.on("session.qr", onQr);
    socket.on("session.pairingCode", onPairingCode);
    socket.on("session.status", onStatus);
    return () => {
      socket.off("session.qr", onQr);
      socket.off("session.pairingCode", onPairingCode);
      socket.off("session.status", onStatus);
    };
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    if (connectMethod === "code" && !pairingPhoneNumber.trim()) return;
    if (connectMethod === "cloud" && (!cloudPhoneNumberId.trim() || !cloudAccessToken.trim() || !cloudAppSecret.trim())) return;
    setCreating(true);
    try {
      const res = await api.post("/whatsapp-sessions", {
        name: newName.trim(),
        provider: connectMethod === "cloud" ? "CLOUD_API" : "BAILEYS",
        pairingPhoneNumber: connectMethod === "code" ? pairingPhoneNumber.trim() : undefined,
        cloudApiPhoneNumberId: connectMethod === "cloud" ? cloudPhoneNumberId.trim() : undefined,
        cloudApiAccessToken: connectMethod === "cloud" ? cloudAccessToken.trim() : undefined,
        cloudApiAppSecret: connectMethod === "cloud" ? cloudAppSecret.trim() : undefined,
      });
      if (connectMethod === "cloud") {
        setCloudWebhookInfo({ url: res.data.webhookUrl, verifyToken: res.data.webhookVerifyToken });
      }
      setNewName("");
      setPairingPhoneNumber("");
      setCloudPhoneNumberId("");
      setCloudAccessToken("");
      setCloudAppSecret("");
      await refresh();
    } finally {
      setCreating(false);
    }
  }

  async function handleRestart(id: string) {
    await api.post(`/whatsapp-sessions/${id}/restart`);
  }

  async function handleLogout(id: string) {
    await api.post(`/whatsapp-sessions/${id}/logout`);
  }

  async function handleResyncLabels(id: string) {
    await api.post(`/whatsapp-sessions/${id}/resync-labels`);
  }

  async function handleRefreshPhoneNumber(id: string) {
    const res = await api.post(`/whatsapp-sessions/${id}/refresh-phone-number`);
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, phoneNumber: res.data.phoneNumber } : s)));
  }

  async function handleDelete(id: string) {
    await api.delete(`/whatsapp-sessions/${id}`);
    setConfirmDeleteFor(null);
    await refresh();
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <h1 className="mb-1 text-lg font-semibold text-gray-900">Conexão com o WhatsApp</h1>
      <p className="mb-6 text-sm text-gray-500">
        Conecte um número de WhatsApp escaneando o QR Code, como no WhatsApp Web. Por padrão, cada organização tem
        apenas uma conexão ativa por vez.
      </p>

      {sessions.length > 0 && (
        <p className="mb-6 text-xs text-gray-400">
          Já existe uma conexão ativa. Apague-a para poder conectar um número diferente.
        </p>
      )}

      {sessions.length === 0 && (
        <form onSubmit={handleCreate} className="mb-6 max-w-xl rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome do número (ex: Comercial, Suporte)"
            className="mb-3 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />

          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={connectMethod === "qr"} onChange={() => setConnectMethod("qr")} />
              QR Code
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={connectMethod === "code"} onChange={() => setConnectMethod("code")} />
              Código de pareamento (para conectar por número, à distância)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={connectMethod === "cloud"} onChange={() => setConnectMethod("cloud")} />
              API Oficial (Meta)
            </label>
          </div>

          {connectMethod === "code" && (
            <input
              value={pairingPhoneNumber}
              onChange={(e) => setPairingPhoneNumber(e.target.value)}
              placeholder="Número do funcionário com DDI e DDD (ex: 5511999998888)"
              className="mb-3 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          )}

          {connectMethod === "cloud" && (
            <div className="mb-3 space-y-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">
                Use quando o número já está cadastrado na WhatsApp Business Platform da Meta (Cloud API) — cole as
                credenciais do seu App em Meta for Developers.
              </p>
              <input
                value={cloudPhoneNumberId}
                onChange={(e) => setCloudPhoneNumberId(e.target.value)}
                placeholder="Phone Number ID"
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <input
                value={cloudAccessToken}
                onChange={(e) => setCloudAccessToken(e.target.value)}
                placeholder="Access Token"
                type="password"
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <input
                value={cloudAppSecret}
                onChange={(e) => setCloudAppSecret(e.target.value)}
                placeholder="App Secret"
                type="password"
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={
              creating ||
              !newName.trim() ||
              (connectMethod === "code" && !pairingPhoneNumber.trim()) ||
              (connectMethod === "cloud" && (!cloudPhoneNumberId.trim() || !cloudAccessToken.trim() || !cloudAppSecret.trim()))
            }
            className="rounded-xl bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Conectar novo número
          </button>
        </form>
      )}

      {cloudWebhookInfo && (
        <div className="mb-6 max-w-xl rounded-2xl border border-brand bg-brand/5 p-4 text-sm">
          <p className="mb-2 font-medium text-brand-dark">Configure o webhook no painel da Meta</p>
          <p className="mb-2 text-xs text-gray-600">
            Em Meta for Developers → seu App → WhatsApp → Configuração → Webhook, cole:
          </p>
          <p className="mb-1 text-xs text-gray-500">URL de retorno de chamada:</p>
          <code className="mb-2 block break-all rounded bg-white px-2 py-1 text-xs">{cloudWebhookInfo.url}</code>
          <p className="mb-1 text-xs text-gray-500">Verificar token:</p>
          <code className="block break-all rounded bg-white px-2 py-1 text-xs">{cloudWebhookInfo.verifyToken}</code>
          <p className="mt-2 text-xs text-gray-500">
            Não esqueça de inscrever o campo <code className="rounded bg-white px-1">messages</code> nesse webhook.
          </p>
          <button
            onClick={() => setCloudWebhookInfo(null)}
            className="mt-2 text-xs font-medium text-gray-500 hover:underline"
          >
            Fechar
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sessions.map((session) => (
          <div key={session.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-medium">
                {session.name}
                {session.provider === "CLOUD_API" && (
                  <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">API Oficial</span>
                )}
              </p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[session.status]}`}>
                {statusLabel[session.status]}
              </span>
            </div>
            {session.phoneNumber && <p className="mb-2 text-sm text-gray-500">+{session.phoneNumber}</p>}
            {session.provider === "BAILEYS" && session.status === SessionStatus.PENDING && session.qrCode && (
              <img src={session.qrCode} alt="QR Code" className="mx-auto h-48 w-48" />
            )}
            {session.provider === "BAILEYS" && session.status === SessionStatus.PENDING && session.pairingCode && (
              <div className="rounded-xl bg-gray-50 py-6 text-center">
                <p className="mb-1 text-xs text-gray-500">Digite este código no WhatsApp do funcionário</p>
                <p className="mb-1 text-xs text-gray-400">
                  Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone
                </p>
                <p className="font-mono text-2xl font-semibold tracking-widest text-brand-dark">
                  {formatPairingCode(session.pairingCode)}
                </p>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {session.provider === "BAILEYS" && (
                <button onClick={() => handleRestart(session.id)} className="text-xs font-medium text-brand-dark hover:underline">
                  Reiniciar
                </button>
              )}
              <button onClick={() => handleLogout(session.id)} className="text-xs font-medium text-red-600 hover:underline">
                Desconectar
              </button>
              {session.phoneNumber ? (
                <button
                  onClick={() => setLinkGeneratorFor((v) => (v === session.id ? null : session.id))}
                  className="text-xs font-medium text-brand-dark hover:underline"
                >
                  🔗 Links personalizados
                </button>
              ) : (
                session.provider === "CLOUD_API" && (
                  <button
                    onClick={() => handleRefreshPhoneNumber(session.id)}
                    className="text-xs font-medium text-brand-dark hover:underline"
                  >
                    🔄 Buscar número (para gerar links)
                  </button>
                )
              )}
              {session.provider === "BAILEYS" && session.status === SessionStatus.CONNECTED && (
                <button onClick={() => handleResyncLabels(session.id)} className="text-xs font-medium text-brand-dark hover:underline">
                  🔄 Ressincronizar etiquetas
                </button>
              )}
              {session.provider === "CLOUD_API" && (
                <button
                  onClick={() => setCredentialsFormFor((v) => (v === session.id ? null : session.id))}
                  className="text-xs font-medium text-brand-dark hover:underline"
                >
                  🔑 Atualizar token
                </button>
              )}
              {confirmDeleteFor === session.id ? (
                <span className="flex w-full flex-wrap items-center gap-2 text-xs">
                  <span className="text-gray-500">Apagar esta conexão? As conversas já registradas continuam salvas.</span>
                  <button onClick={() => handleDelete(session.id)} className="font-medium text-red-600 hover:underline">
                    Confirmar
                  </button>
                  <button onClick={() => setConfirmDeleteFor(null)} className="text-gray-400 hover:underline">
                    Cancelar
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirmDeleteFor(session.id)} className="text-xs font-medium text-red-600 hover:underline">
                  🗑️ Apagar
                </button>
              )}
            </div>
            {session.phoneNumber && linkGeneratorFor === session.id && (
              <WaLinkGenerator sessionId={session.id} phoneNumber={session.phoneNumber} />
            )}
            {credentialsFormFor === session.id && (
              <CloudApiCredentialsForm sessionId={session.id} onClose={() => setCredentialsFormFor(null)} />
            )}
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="text-sm text-gray-500">Nenhum número conectado ainda. Use o formulário acima para conectar o primeiro.</p>
        )}
      </div>
    </div>
  );
}
