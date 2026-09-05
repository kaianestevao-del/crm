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
}

const statusLabel: Record<SessionStatus, string> = {
  [SessionStatus.PENDING]: "Aguardando leitura do QR Code",
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

export function ConnectWhatsappPage() {
  const [sessions, setSessions] = useState<WhatsappSession[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  async function refresh() {
    const res = await api.get("/whatsapp-sessions");
    setSessions(res.data);
  }

  useEffect(() => {
    refresh();
    const socket = getSocket();
    if (!socket) return;

    const onQr = (evt: { sessionId: string; qr: string }) => {
      setSessions((prev) => prev.map((s) => (s.id === evt.sessionId ? { ...s, qrCode: evt.qr, status: SessionStatus.PENDING } : s)));
    };
    const onStatus = (evt: { sessionId: string; status: SessionStatus; phoneNumber?: string | null }) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === evt.sessionId
            ? { ...s, status: evt.status, phoneNumber: evt.phoneNumber ?? s.phoneNumber, qrCode: evt.status === SessionStatus.CONNECTED ? null : s.qrCode }
            : s,
        ),
      );
    };

    socket.on("session.qr", onQr);
    socket.on("session.status", onStatus);
    return () => {
      socket.off("session.qr", onQr);
      socket.off("session.status", onStatus);
    };
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.post("/whatsapp-sessions", { name: newName.trim() });
      setNewName("");
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

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-1 text-lg font-semibold">Conexão com o WhatsApp</h1>
      <p className="mb-6 text-sm text-gray-500">
        Conecte um número de WhatsApp escaneando o QR Code, como no WhatsApp Web. Um único número pode ser usado por múltiplos atendentes.
      </p>

      <form onSubmit={handleCreate} className="mb-6 flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nome do número (ex: Comercial, Suporte)"
          className="w-72 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Conectar novo número
        </button>
      </form>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sessions.map((session) => (
          <div key={session.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-medium">{session.name}</p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[session.status]}`}>
                {statusLabel[session.status]}
              </span>
            </div>
            {session.phoneNumber && <p className="mb-2 text-sm text-gray-500">+{session.phoneNumber}</p>}
            {session.status === SessionStatus.PENDING && session.qrCode && (
              <img src={session.qrCode} alt="QR Code" className="mx-auto h-48 w-48" />
            )}
            <div className="mt-3 flex gap-2">
              <button onClick={() => handleRestart(session.id)} className="text-xs font-medium text-brand-dark hover:underline">
                Reiniciar
              </button>
              <button onClick={() => handleLogout(session.id)} className="text-xs font-medium text-red-600 hover:underline">
                Desconectar
              </button>
            </div>
          </div>
        ))}
        {sessions.length === 0 && <p className="text-sm text-gray-500">Nenhum número conectado ainda.</p>}
      </div>
    </div>
  );
}
