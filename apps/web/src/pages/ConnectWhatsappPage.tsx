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

function WaLinkGenerator({ phoneNumber }: { phoneNumber: string }) {
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const link = `https://wa.me/${phoneNumber}${message.trim() ? `?text=${encodeURIComponent(message.trim())}` : ""}`;

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
    <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3">
      <label className="mb-1 block text-xs font-medium text-gray-600">Mensagem pré-preenchida (opcional)</label>
      <input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Ex: Olá! Vim pelo Instagram e quero saber mais..."
        className="mb-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <input readOnly value={link} className="flex-1 truncate rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-600" />
        <button
          onClick={handleCopy}
          className="whitespace-nowrap rounded-md bg-brand-dark px-2 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          {copied ? "Copiado!" : "Copiar link"}
        </button>
      </div>
      <p className="mt-1 text-[10px] text-gray-400">
        Compartilhe esse link (bio, site, anúncios) para que qualquer pessoa abra uma conversa com este número no WhatsApp.
      </p>
    </div>
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

  async function handleDelete(id: string) {
    await api.delete(`/whatsapp-sessions/${id}`);
    setConfirmDeleteFor(null);
    await refresh();
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-1 text-lg font-semibold">Conexão com o WhatsApp</h1>
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
        <form onSubmit={handleCreate} className="mb-6 max-w-xl rounded-lg border border-gray-200 bg-white p-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome do número (ex: Comercial, Suporte)"
            className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
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
              className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          )}

          {connectMethod === "cloud" && (
            <div className="mb-3 space-y-2 rounded-md border border-dashed border-gray-300 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">
                Use quando o número já está cadastrado na WhatsApp Business Platform da Meta (Cloud API) — cole as
                credenciais do seu App em Meta for Developers.
              </p>
              <input
                value={cloudPhoneNumberId}
                onChange={(e) => setCloudPhoneNumberId(e.target.value)}
                placeholder="Phone Number ID"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <input
                value={cloudAccessToken}
                onChange={(e) => setCloudAccessToken(e.target.value)}
                placeholder="Access Token"
                type="password"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <input
                value={cloudAppSecret}
                onChange={(e) => setCloudAppSecret(e.target.value)}
                placeholder="App Secret"
                type="password"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
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
            className="rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Conectar novo número
          </button>
        </form>
      )}

      {cloudWebhookInfo && (
        <div className="mb-6 max-w-xl rounded-lg border border-brand bg-brand/5 p-4 text-sm">
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
          <div key={session.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
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
              <div className="rounded-md bg-gray-50 py-6 text-center">
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
              {session.phoneNumber && (
                <button
                  onClick={() => setLinkGeneratorFor((v) => (v === session.id ? null : session.id))}
                  className="text-xs font-medium text-brand-dark hover:underline"
                >
                  🔗 Gerar link wa.me
                </button>
              )}
              {session.provider === "BAILEYS" && session.status === SessionStatus.CONNECTED && (
                <button onClick={() => handleResyncLabels(session.id)} className="text-xs font-medium text-brand-dark hover:underline">
                  🔄 Ressincronizar etiquetas
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
            {session.phoneNumber && linkGeneratorFor === session.id && <WaLinkGenerator phoneNumber={session.phoneNumber} />}
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="text-sm text-gray-500">Nenhum número conectado ainda. Use o formulário acima para conectar o primeiro.</p>
        )}
      </div>
    </div>
  );
}
