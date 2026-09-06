import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MessageDirection, MessageType } from "@crm/shared";
import { api, API_URL } from "../lib/api";
import { getSocket } from "../lib/socket";
import { QuickReplyPicker, QuickReply } from "../components/QuickReplyPicker";
import { ContactNotes } from "../components/ContactNotes";
import { ContactTags, Tag } from "../components/ContactTags";
import { ContactWhatsappLabels, WhatsappLabel } from "../components/ContactWhatsappLabels";
import { ContactDeal } from "../components/ContactDeal";
import { ContactAvatar, contactLabel } from "../components/ContactAvatar";
import { useAuth } from "../context/AuthContext";
import { SignatureSettings } from "../components/SignatureSettings";
import { TranscriptionSettings } from "../components/TranscriptionSettings";
import { AudioRecorderBar } from "../components/AudioRecorderBar";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { NewConversationModal } from "../components/NewConversationModal";
import { ScheduledMessages } from "../components/ScheduledMessages";
import { downloadFile } from "../lib/download";

interface Contact {
  id: string;
  name: string | null;
  phoneNumber: string;
  avatarUrl: string | null;
  tags: Tag[];
  whatsappLabels: WhatsappLabel[];
}

interface Conversation {
  id: string;
  contact: Contact;
  assignedUser: { id: string; name: string } | null;
  unreadCount: number;
  lastMessageAt: string;
  messages: Message[];
}

interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  content: string | null;
  mediaUrl: string | null;
  transcript: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const MEDIA_PREVIEW_LABEL: Partial<Record<MessageType, string>> = {
  [MessageType.IMAGE]: "🖼️ Imagem",
  [MessageType.AUDIO]: "🎤 Áudio",
  [MessageType.VIDEO]: "🎞️ Vídeo",
  [MessageType.DOCUMENT]: "📄 Documento",
};

function messagePreview(message: Message | undefined) {
  if (!message) return "Sem mensagens";
  return message.content || MEDIA_PREVIEW_LABEL[message.type] || "Sem mensagens";
}

function MessageBubble({ message }: { message: Message }) {
  const outbound = message.direction === MessageDirection.OUTBOUND;
  const mediaSrc = message.mediaUrl ? `${API_URL}${message.mediaUrl}` : null;

  return (
    <div
      className={`max-w-md rounded-lg px-3 py-2 text-sm ${
        outbound ? "ml-auto bg-brand-dark text-white" : "bg-white text-gray-900 shadow-sm"
      }`}
    >
      {message.revokedAt && (
        <p className={`mb-1 text-xs italic ${outbound ? "text-white/70" : "text-gray-400"}`}>
          🚫 Apagada pelo remetente — conteúdo original preservado
        </p>
      )}
      {message.type === MessageType.IMAGE && mediaSrc && (
        <img src={mediaSrc} alt="" className="mb-1 max-h-64 rounded-md object-cover" />
      )}
      {message.type === MessageType.VIDEO && mediaSrc && <video src={mediaSrc} controls className="mb-1 max-h-64 rounded-md" />}
      {message.type === MessageType.AUDIO && mediaSrc && (
        <>
          <audio src={mediaSrc} controls className="mb-1 max-w-full" />
          {message.transcript ? (
            <p className={`mt-1 text-xs italic ${outbound ? "text-white/80" : "text-gray-500"}`}>🗒️ "{message.transcript}"</p>
          ) : (
            <p className={`mt-1 text-xs italic ${outbound ? "text-white/50" : "text-gray-400"}`}>
              🗒️ Transcrevendo ou indisponível (configure a chave Groq em "🗒️ Transcrição")
            </p>
          )}
        </>
      )}
      {message.type === MessageType.DOCUMENT && mediaSrc && (
        <a
          href={mediaSrc}
          target="_blank"
          rel="noreferrer"
          className={`mb-1 flex items-center gap-1 underline ${outbound ? "text-white" : "text-brand-dark"}`}
        >
          📄 Abrir documento
        </a>
      )}
      {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
    </div>
  );
}

export function InboxPage() {
  const { organization } = useAuth();
  const canAccessKanban = organization?.allowedModules.includes("kanban") ?? false;
  const location = useLocation();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showSignatureSettings, setShowSignatureSettings] = useState(false);
  const [showTranscriptionSettings, setShowTranscriptionSettings] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pendingQuickReply, setPendingQuickReply] = useState<QuickReply | null>(null);
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [showScheduledMessages, setShowScheduledMessages] = useState(false);
  const [search, setSearch] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const audioRecorder = useAudioRecorder();

  async function refreshConversations() {
    const res = await api.get("/conversations");
    setConversations(res.data);
  }

  useEffect(() => {
    refreshConversations();
  }, []);

  // Arriving from the Kanban board's "Ir para Caixa de Entrada" button: open that contact's
  // conversation as soon as the list has loaded, then clear the nav state so it doesn't
  // re-trigger on a later re-render (e.g. after sending a message).
  useEffect(() => {
    const contactId = (location.state as { contactId?: string } | null)?.contactId;
    if (!contactId || conversations.length === 0) return;
    const match = conversations.find((c) => c.contact.id === contactId);
    if (match) selectConversation(match.id);
    navigate(location.pathname, { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, location.state]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onNewMessage = (evt: { conversationId: string; message: Message }) => {
      if (evt.conversationId === selectedId) {
        setMessages((prev) => [...prev, evt.message]);
      }
    };
    const onMessageUpdated = (evt: { conversationId: string; message: Message }) => {
      if (evt.conversationId === selectedId) {
        setMessages((prev) => prev.map((m) => (m.id === evt.message.id ? evt.message : m)));
      }
    };
    const onConversationUpdated = () => {
      refreshConversations();
    };
    // Fires when WhatsApp confirms a native label was added/removed/created for a contact.
    const onContactUpdated = () => {
      refreshConversations();
    };

    socket.on("message.new", onNewMessage);
    socket.on("message.updated", onMessageUpdated);
    socket.on("conversation.updated", onConversationUpdated);
    socket.on("contact.updated", onContactUpdated);
    return () => {
      socket.off("message.new", onNewMessage);
      socket.off("message.updated", onMessageUpdated);
      socket.off("conversation.updated", onConversationUpdated);
      socket.off("contact.updated", onContactUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function selectConversation(id: string) {
    setSelectedId(id);
    setShowQuickReplies(false);
    setShowNotes(false);
    setShowScheduledMessages(false);
    setPendingQuickReply(null);
    setDraft("");
    const res = await api.get(`/conversations/${id}/messages`);
    setMessages(res.data);
    await api.post(`/conversations/${id}/read`);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    if (!pendingQuickReply && !draft.trim()) return;
    setSending(true);
    try {
      const body = pendingQuickReply
        ? { quickReplyId: pendingQuickReply.id, text: draft.trim() || undefined }
        : { text: draft.trim() };
      const res = await api.post(`/conversations/${selectedId}/messages`, body);
      setMessages((prev) => [...prev, res.data]);
      setDraft("");
      setPendingQuickReply(null);
    } finally {
      setSending(false);
    }
  }

  function handlePickQuickReply(quickReply: QuickReply) {
    setShowQuickReplies(false);
    setPendingQuickReply(quickReply);
    setDraft(quickReply.content ?? "");
  }

  function cancelPendingQuickReply() {
    setPendingQuickReply(null);
    setDraft("");
  }

  async function sendAttachmentFile(file: File) {
    if (!selectedId) return;
    const formData = new FormData();
    formData.append("file", file);
    setSending(true);
    try {
      const res = await api.post(`/conversations/${selectedId}/attachments`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setMessages((prev) => [...prev, res.data]);
    } finally {
      setSending(false);
    }
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await sendAttachmentFile(file);
  }

  async function handleExport() {
    if (!selectedConversation) return;
    setExporting(true);
    try {
      const res = await api.get(`/conversations/${selectedConversation.id}/export`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `conversa-${contactLabel(selectedConversation.contact).replace(/[^a-z0-9]+/gi, "_")}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function handleConversationCreated(conversationId: string) {
    setShowNewConversation(false);
    await refreshConversations();
    await selectConversation(conversationId);
  }

  function toggleTagFilter(tagId: string) {
    setTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  const allTags = Array.from(new Map(conversations.flatMap((c) => c.contact.tags).map((t) => [t.id, t])).values());

  const normalizedSearch = search.trim().toLowerCase();
  const visibleConversations = conversations
    .filter((c) => tagFilter.size === 0 || c.contact.tags.some((t) => tagFilter.has(t.id)))
    .filter(
      (c) =>
        !normalizedSearch ||
        contactLabel(c.contact).toLowerCase().includes(normalizedSearch) ||
        c.contact.phoneNumber.includes(normalizedSearch),
    );

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      <div className="flex w-80 flex-shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
          <p className="text-sm font-semibold">Conversas</p>
          <div className="flex gap-2">
            <button
              onClick={() => downloadFile("/contacts/export", "contatos.xlsx")}
              title="Exportar contatos para XLSX"
              className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              ⬇️ Contatos
            </button>
            <button
              onClick={() => setShowNewConversation(true)}
              className="rounded-md bg-brand-dark px-2 py-1 text-xs font-medium text-white hover:opacity-90"
            >
              + Nova conversa
            </button>
          </div>
        </div>
        <div className="border-b border-gray-100 p-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              className="w-full rounded-md border border-gray-300 py-1.5 pl-7 pr-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-gray-100 p-2">
            {allTags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => toggleTagFilter(tag.id)}
                className={`rounded-full px-2 py-0.5 text-xs ${
                  tagFilter.has(tag.id) ? "bg-brand-dark text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                {tag.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {visibleConversations.map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => selectConversation(conversation.id)}
              className={`block w-full border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50 ${
                selectedId === conversation.id ? "bg-brand/5" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <ContactAvatar contact={conversation.contact} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="truncate text-sm font-medium">{contactLabel(conversation.contact)}</p>
                    {conversation.unreadCount > 0 && (
                      <span className="rounded-full bg-brand-dark px-2 py-0.5 text-xs font-medium text-white">
                        {conversation.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-gray-500">{messagePreview(conversation.messages[0])}</p>
                </div>
              </div>
            </button>
          ))}
          {visibleConversations.length === 0 && <p className="p-4 text-sm text-gray-500">Nenhuma conversa ainda.</p>}
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        {selectedConversation ? (
          <>
            <div className="border-b border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ContactAvatar contact={selectedConversation.contact} />
                  <p className="font-medium">{contactLabel(selectedConversation.contact)}</p>
                </div>
                <div className="relative flex gap-2">
                  <button
                    onClick={handleExport}
                    disabled={exporting}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    ⬇️ Baixar histórico
                  </button>
                  <button
                    onClick={() => setShowTranscriptionSettings((v) => !v)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    🗒️ Transcrição
                  </button>
                  {showTranscriptionSettings && <TranscriptionSettings onClose={() => setShowTranscriptionSettings(false)} />}
                  <button
                    onClick={() => setShowSignatureSettings((v) => !v)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    ✍️ Assinatura
                  </button>
                  {showSignatureSettings && <SignatureSettings onClose={() => setShowSignatureSettings(false)} />}
                  <button
                    onClick={() => setShowNotes((v) => !v)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    📝 Anotações
                  </button>
                  <button
                    onClick={() => setShowScheduledMessages((v) => !v)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    📅 Agendar
                  </button>
                  {showScheduledMessages && (
                    <ScheduledMessages conversationId={selectedConversation.id} onClose={() => setShowScheduledMessages(false)} />
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <ContactTags
                  contactId={selectedConversation.contact.id}
                  tags={selectedConversation.contact.tags}
                  onChange={(tags) =>
                    setConversations((prev) =>
                      prev.map((c) => (c.id === selectedConversation.id ? { ...c, contact: { ...c.contact, tags } } : c)),
                    )
                  }
                />
                <span className="h-4 w-px bg-gray-200" />
                <ContactWhatsappLabels
                  contactId={selectedConversation.contact.id}
                  labels={selectedConversation.contact.whatsappLabels}
                  onChange={(whatsappLabels) =>
                    setConversations((prev) =>
                      prev.map((c) =>
                        c.id === selectedConversation.id ? { ...c, contact: { ...c.contact, whatsappLabels } } : c,
                      ),
                    )
                  }
                />
                {canAccessKanban && (
                  <>
                    <span className="h-4 w-px bg-gray-200" />
                    <ContactDeal key={selectedConversation.contact.id} contactId={selectedConversation.contact.id} />
                  </>
                )}
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto bg-gray-50 p-4">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={handleSend} className="relative border-t border-gray-200 bg-white p-3">
              {showQuickReplies && <QuickReplyPicker onPick={handlePickQuickReply} onClose={() => setShowQuickReplies(false)} />}

              {pendingQuickReply && (
                <div className="mb-2 flex items-center justify-between rounded-md border border-brand bg-brand/5 px-3 py-2 text-xs">
                  <span>
                    Pré-visualizando resposta rápida: <strong>{pendingQuickReply.title}</strong>
                    {pendingQuickReply.type !== "TEXT" && " (mídia anexada)"}
                  </span>
                  <button type="button" onClick={cancelPendingQuickReply} className="text-red-600 hover:underline">
                    Cancelar
                  </button>
                </div>
              )}

              <AudioRecorderBar recorder={audioRecorder} onSend={sendAttachmentFile} />

              <div className="flex gap-2">
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChosen} />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={audioRecorder.state !== "idle"}
                  title="Anexar arquivo"
                  className="rounded-md border border-gray-300 px-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  📎
                </button>
                <button
                  type="button"
                  onClick={audioRecorder.start}
                  disabled={audioRecorder.state !== "idle"}
                  title="Gravar áudio"
                  className="rounded-md border border-gray-300 px-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  🎙️
                </button>
                <button
                  type="button"
                  onClick={() => setShowQuickReplies((v) => !v)}
                  title="Respostas rápidas"
                  className="rounded-md border border-gray-300 px-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  ⚡
                </button>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={pendingQuickReply ? "Edite antes de enviar (opcional)..." : "Digite uma mensagem..."}
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={sending}
                  className="rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  Enviar
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
            Selecione uma conversa para começar
          </div>
        )}
      </div>

      {showNotes && selectedConversation && (
        <ContactNotes contactId={selectedConversation.contact.id} onClose={() => setShowNotes(false)} />
      )}

      {showNewConversation && (
        <NewConversationModal onClose={() => setShowNewConversation(false)} onCreated={handleConversationCreated} />
      )}
    </div>
  );
}
