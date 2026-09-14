import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MessageDirection, MessageType, MessageStatus, isMonthYearTagName, ORIGIN_TAGS_PT } from "@crm/shared";
import { api, API_URL } from "../lib/api";
import { getSocket } from "../lib/socket";
import { QuickReplyPicker, QuickReply } from "../components/QuickReplyPicker";
import { EmojiPicker } from "../components/EmojiPicker";
import { ContactNotes } from "../components/ContactNotes";
import { ContactTags, Tag } from "../components/ContactTags";
import { ContactTimeline } from "../components/ContactTimeline";
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
import { Icon } from "../components/Icon";

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
  status: MessageStatus;
  content: string | null;
  mediaUrl: string | null;
  transcript: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const STATUS_ICON: Record<MessageStatus, string> = {
  [MessageStatus.PENDING]: "🕓",
  [MessageStatus.SENT]: "✓",
  [MessageStatus.DELIVERED]: "✓✓",
  [MessageStatus.READ]: "✓✓",
  [MessageStatus.FAILED]: "⚠️",
};

const STATUS_TITLE: Record<MessageStatus, string> = {
  [MessageStatus.PENDING]: "Enviando...",
  [MessageStatus.SENT]: "Enviada",
  [MessageStatus.DELIVERED]: "Entregue",
  [MessageStatus.READ]: "Lida",
  [MessageStatus.FAILED]: "Falha ao enviar",
};

function MessageStatusIndicator({ status }: { status: MessageStatus }) {
  return (
    <span
      title={STATUS_TITLE[status]}
      className={`ml-1 text-[11px] ${
        status === MessageStatus.FAILED
          ? "text-red-300"
          : status === MessageStatus.READ
            ? "text-sky-300"
            : "text-white/70"
      }`}
    >
      {STATUS_ICON[status]}
    </span>
  );
}

const MEDIA_PREVIEW_LABEL: Partial<Record<MessageType, string>> = {
  [MessageType.IMAGE]: "🖼️ Imagem",
  [MessageType.AUDIO]: "🎤 Áudio",
  [MessageType.VIDEO]: "🎞️ Vídeo",
  [MessageType.DOCUMENT]: "📄 Documento",
  [MessageType.CONTACT]: "👤 Contato",
  [MessageType.LOCATION]: "📍 Localização",
  [MessageType.UNKNOWN]: "Mensagem não suportada",
};

function messagePreview(message: Message | undefined) {
  if (!message) return "Sem mensagens";
  if (message.type === MessageType.CONTACT) return "👤 Contato: " + (message.content?.split("|")[0]?.split("\n")[0] ?? "");
  return message.content || MEDIA_PREVIEW_LABEL[message.type] || "Sem mensagens";
}

// Cloud API and Baileys both hand shared-contact text over as one "Name|phone" pair per line
// (see formatCloudContactsText / formatBaileysContactsText on the worker) — this is the other
// half of that convention.
function parseSharedContacts(content: string | null): { name: string; phone: string | null }[] {
  if (!content) return [];
  return content.split("\n").map((line) => {
    const [name, phone] = line.split("|");
    return { name: name || "Contato sem nome", phone: phone || null };
  });
}

function formatMessageTime(iso: string) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  if (isToday) return time;
  const dateLabel = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  return `${dateLabel} ${time}`;
}

function MessageBubble({
  message,
  onStartConversationWithContact,
}: {
  message: Message;
  onStartConversationWithContact: (phoneNumber: string, name: string) => void;
}) {
  const outbound = message.direction === MessageDirection.OUTBOUND;
  const mediaSrc = message.mediaUrl ? `${API_URL}${message.mediaUrl}` : null;

  return (
    <div
      className={`max-w-md rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
        outbound ? "ml-auto bg-brand-dark text-white" : "bg-white text-gray-900"
      }`}
    >
      {message.revokedAt && (
        <p className={`mb-1 text-xs italic ${outbound ? "text-white/70" : "text-gray-400"}`}>
          🚫 Apagada pelo remetente — conteúdo original preservado
        </p>
      )}
      {message.type === MessageType.IMAGE && mediaSrc && (
        <img src={mediaSrc} alt="" className="mb-1 max-h-64 rounded-xl object-cover" />
      )}
      {message.type === MessageType.VIDEO && mediaSrc && <video src={mediaSrc} controls className="mb-1 max-h-64 rounded-xl" />}
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
      {message.type === MessageType.CONTACT && (
        <div className="mb-1 space-y-1.5">
          {parseSharedContacts(message.content).map((c, i) => (
            <div
              key={i}
              className={`flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 ${
                outbound ? "border-white/30" : "border-gray-200"
              }`}
            >
              <div className="min-w-0">
                <p className="truncate font-medium">👤 {c.name}</p>
                {c.phone && <p className={`truncate text-xs ${outbound ? "text-white/70" : "text-gray-500"}`}>+{c.phone}</p>}
              </div>
              {c.phone && (
                <button
                  type="button"
                  onClick={() => onStartConversationWithContact(c.phone!, c.name)}
                  className={`shrink-0 rounded-lg px-2 py-1 text-xs font-medium ${
                    outbound ? "bg-white/20 hover:bg-white/30" : "bg-brand/10 text-brand-dark hover:bg-brand/20"
                  }`}
                >
                  Conversar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {message.type === MessageType.LOCATION && message.content && (
        <a
          href={`https://www.google.com/maps?q=${encodeURIComponent(message.content.split("\n").pop() ?? "")}`}
          target="_blank"
          rel="noreferrer"
          className={`mb-1 flex items-center gap-1 underline ${outbound ? "text-white" : "text-brand-dark"}`}
        >
          📍 {message.content.split("\n")[0] || "Ver localização"}
        </a>
      )}
      {message.content && message.type !== MessageType.CONTACT && message.type !== MessageType.LOCATION && (
        <p className="whitespace-pre-wrap">{message.content}</p>
      )}
      <p className={`mt-0.5 flex items-center justify-end gap-1 text-[11px] ${outbound ? "text-white/70" : "text-gray-400"}`}>
        {formatMessageTime(message.createdAt)}
        {outbound && message.status === MessageStatus.FAILED && <span>Falha ao enviar</span>}
        {outbound && <MessageStatusIndicator status={message.status} />}
      </p>
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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showSignatureSettings, setShowSignatureSettings] = useState(false);
  const [showTranscriptionSettings, setShowTranscriptionSettings] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pendingQuickReply, setPendingQuickReply] = useState<QuickReply | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [labelFilter, setLabelFilter] = useState<Set<string>>(new Set());
  const [originFilter, setOriginFilter] = useState<Set<string>>(new Set());
  const [monthFilter, setMonthFilter] = useState<Set<string>>(new Set());
  const [objetivoFilter, setObjetivoFilter] = useState<Set<string>>(new Set());
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [confirmDeleteConversationFor, setConfirmDeleteConversationFor] = useState<string | null>(null);
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [showScheduledMessages, setShowScheduledMessages] = useState(false);
  const [search, setSearch] = useState("");
  const [editingContactName, setEditingContactName] = useState(false);
  const [contactNameDraft, setContactNameDraft] = useState("");
  const [savingContactName, setSavingContactName] = useState(false);
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
    setEditingContactName(false);
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

  function startEditingContactName() {
    if (!selectedConversation) return;
    setContactNameDraft(selectedConversation.contact.name ?? "");
    setEditingContactName(true);
  }

  async function saveContactName() {
    if (!selectedConversation) return;
    const name = contactNameDraft.trim();
    if (!name) return;
    setSavingContactName(true);
    try {
      const res = await api.patch(`/contacts/${selectedConversation.contact.id}`, { name });
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedConversation.id ? { ...c, contact: { ...c.contact, name: res.data.name } } : c)),
      );
      setEditingContactName(false);
    } finally {
      setSavingContactName(false);
    }
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

  // Used by the "Conversar" button on a shared-contact bubble — same endpoint the "Nova
  // conversa" modal uses, just triggered from inside a message instead of a form.
  async function startConversationWithPhone(phoneNumber: string, name: string) {
    const res = await api.post("/conversations/start", { phoneNumber, name: name || undefined });
    await handleConversationCreated(res.data.id);
  }

  function toggleInSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function handleMarkUnread(conversationId: string) {
    await api.post(`/conversations/${conversationId}/unread`);
    setMenuOpenFor(null);
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 1 } : c)));
  }

  async function handleDeleteConversation(conversationId: string) {
    await api.delete(`/conversations/${conversationId}`);
    setMenuOpenFor(null);
    setConfirmDeleteConversationFor(null);
    if (selectedId === conversationId) setSelectedId(null);
    setConversations((prev) => prev.filter((c) => c.id !== conversationId));
  }

  const allTags = Array.from(new Map(conversations.flatMap((c) => c.contact.tags).map((t) => [t.id, t])).values());
  const allLabels = Array.from(
    new Map(conversations.flatMap((c) => c.contact.whatsappLabels).map((l) => [l.id, l])).values(),
  );
  const isOriginTagName = (name: string) => (ORIGIN_TAGS_PT as readonly string[]).includes(name);
  const originTags = allTags.filter((t) => isOriginTagName(t.name));
  const monthTags = allTags.filter((t) => isMonthYearTagName(t.name));
  const objetivoTags = allTags.filter((t) => !isOriginTagName(t.name) && !isMonthYearTagName(t.name));

  const activeFilterCount =
    (unreadOnly ? 1 : 0) +
    (labelFilter.size > 0 ? 1 : 0) +
    (originFilter.size > 0 ? 1 : 0) +
    (monthFilter.size > 0 ? 1 : 0) +
    (objetivoFilter.size > 0 ? 1 : 0);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleConversations = conversations
    .filter((c) => !unreadOnly || c.unreadCount > 0)
    .filter((c) => labelFilter.size === 0 || c.contact.whatsappLabels.some((l) => labelFilter.has(l.id)))
    .filter((c) => originFilter.size === 0 || c.contact.tags.some((t) => originFilter.has(t.id)))
    .filter((c) => monthFilter.size === 0 || c.contact.tags.some((t) => monthFilter.has(t.id)))
    .filter((c) => objetivoFilter.size === 0 || c.contact.tags.some((t) => objetivoFilter.has(t.id)))
    .filter(
      (c) =>
        !normalizedSearch ||
        contactLabel(c.contact).toLowerCase().includes(normalizedSearch) ||
        c.contact.phoneNumber.includes(normalizedSearch),
    );

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex h-full bg-gray-50">
      <div className="flex w-80 flex-shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-3">
          <p className="text-sm font-semibold text-gray-900">Conversas</p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1 rounded-xl border px-2 py-1 text-xs font-medium hover:bg-gray-50 ${
                activeFilterCount > 0 ? "border-brand-dark bg-brand/5 text-brand-dark" : "border-gray-200 text-gray-600"
              }`}
            >
              <Icon name="filter" className="h-3.5 w-3.5" />
              Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>
            <button
              onClick={() => setShowNewConversation(true)}
              className="flex items-center gap-1 rounded-xl bg-brand-dark px-2 py-1 text-xs font-medium text-white shadow-sm hover:opacity-90"
            >
              <Icon name="plus" className="h-3.5 w-3.5" />
              Nova conversa
            </button>
          </div>
        </div>
        <div className="border-b border-gray-100 p-2">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              className="w-full rounded-xl border border-gray-200 py-1.5 pl-8 pr-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
        </div>
        {showFilters && (
          <div className="space-y-2 border-b border-gray-100 p-2">
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
              Apenas não lidas
            </label>

            {allLabels.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-gray-400">Etiquetas</p>
                <div className="flex flex-wrap gap-1">
                  {allLabels.map((label) => (
                    <button
                      key={label.id}
                      onClick={() => toggleInSet(setLabelFilter, label.id)}
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        labelFilter.has(label.id) ? "bg-brand-dark text-white" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {label.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {originTags.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-gray-400">Origem</p>
                <div className="flex flex-wrap gap-1">
                  {originTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => toggleInSet(setOriginFilter, tag.id)}
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        originFilter.has(tag.id) ? "bg-brand-dark text-white" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {monthTags.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-gray-400">Mês</p>
                <div className="flex flex-wrap gap-1">
                  {monthTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => toggleInSet(setMonthFilter, tag.id)}
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        monthFilter.has(tag.id) ? "bg-brand-dark text-white" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {objetivoTags.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-gray-400">Objetivos</p>
                <div className="flex flex-wrap gap-1">
                  {objetivoTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => toggleInSet(setObjetivoFilter, tag.id)}
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        objetivoFilter.has(tag.id) ? "bg-brand-dark text-white" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeFilterCount > 0 && (
              <button
                onClick={() => {
                  setUnreadOnly(false);
                  setLabelFilter(new Set());
                  setOriginFilter(new Set());
                  setMonthFilter(new Set());
                  setObjetivoFilter(new Set());
                }}
                className="text-xs text-gray-400 hover:underline"
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {visibleConversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`group relative rounded-xl ${
                selectedId === conversation.id ? "bg-brand/10" : "hover:bg-gray-50"
              }`}
            >
              <button onClick={() => selectConversation(conversation.id)} className="block w-full px-3 py-2.5 pr-9 text-left">
                <div className="flex items-center gap-2.5">
                  <ContactAvatar contact={conversation.contact} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="truncate text-sm font-medium text-gray-800">{contactLabel(conversation.contact)}</p>
                      {conversation.unreadCount > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-dark px-1.5 text-xs font-medium text-white">
                          {conversation.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-gray-500">{messagePreview(conversation.messages[0])}</p>
                  </div>
                </div>
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpenFor((v) => (v === conversation.id ? null : conversation.id));
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-1.5 py-1 text-gray-400 opacity-0 hover:bg-gray-200 group-hover:opacity-100"
                title="Mais opções"
              >
                ⋮
              </button>

              {menuOpenFor === conversation.id && (
                <div className="absolute right-2 top-11 z-10 w-48 rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-lg">
                  <button
                    onClick={() => handleMarkUnread(conversation.id)}
                    className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50"
                  >
                    Marcar como não lida
                  </button>
                  {confirmDeleteConversationFor === conversation.id ? (
                    <div className="px-3 py-1.5">
                      <p className="mb-1 text-xs text-gray-500">Apagar esta conversa? As mensagens continuam salvas.</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDeleteConversation(conversation.id)}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Confirmar
                        </button>
                        <button
                          onClick={() => setConfirmDeleteConversationFor(null)}
                          className="text-xs text-gray-400 hover:underline"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteConversationFor(conversation.id)}
                      className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-gray-50"
                    >
                      Apagar conversa
                    </button>
                  )}
                </div>
              )}
            </div>
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
                  {editingContactName ? (
                    <>
                      <input
                        autoFocus
                        value={contactNameDraft}
                        onChange={(e) => setContactNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveContactName();
                          if (e.key === "Escape") setEditingContactName(false);
                        }}
                        className="w-40 rounded-xl border border-gray-300 px-2 py-1 text-sm focus:border-brand focus:outline-none"
                      />
                      <button
                        onClick={saveContactName}
                        disabled={savingContactName || !contactNameDraft.trim()}
                        className="text-xs font-medium text-brand-dark hover:underline disabled:opacity-50"
                      >
                        Salvar
                      </button>
                      <button onClick={() => setEditingContactName(false)} className="text-xs text-gray-400 hover:underline">
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="font-medium">{contactLabel(selectedConversation.contact)}</p>
                      <button
                        onClick={startEditingContactName}
                        title="Editar nome"
                        className="text-gray-300 hover:text-brand-dark"
                      >
                        ✏️
                      </button>
                    </>
                  )}
                </div>
                <div className="relative flex gap-2">
                  <button
                    onClick={handleExport}
                    disabled={exporting}
                    className="rounded-xl border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    ⬇️ Baixar histórico
                  </button>
                  <button
                    onClick={() => setShowTranscriptionSettings((v) => !v)}
                    className="rounded-xl border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    🗒️ Transcrição
                  </button>
                  {showTranscriptionSettings && <TranscriptionSettings onClose={() => setShowTranscriptionSettings(false)} />}
                  <button
                    onClick={() => setShowSignatureSettings((v) => !v)}
                    className="rounded-xl border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    ✍️ Assinatura
                  </button>
                  {showSignatureSettings && <SignatureSettings onClose={() => setShowSignatureSettings(false)} />}
                  <button
                    onClick={() => setShowNotes((v) => !v)}
                    className="rounded-xl border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    📝 Anotações
                  </button>
                  <button
                    onClick={() => setShowScheduledMessages((v) => !v)}
                    className="rounded-xl border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    📅 Agendar
                  </button>
                  {showScheduledMessages && (
                    <ScheduledMessages conversationId={selectedConversation.id} onClose={() => setShowScheduledMessages(false)} />
                  )}
                </div>
              </div>
              <div className="mt-2">
                <ContactTimeline
                  contactId={selectedConversation.contact.id}
                  tags={selectedConversation.contact.tags}
                  onChange={(tags) =>
                    setConversations((prev) =>
                      prev.map((c) => (c.id === selectedConversation.id ? { ...c, contact: { ...c.contact, tags } } : c)),
                    )
                  }
                />
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
                <MessageBubble key={message.id} message={message} onStartConversationWithContact={startConversationWithPhone} />
              ))}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={handleSend} className="relative border-t border-gray-200 bg-white p-3">
              {showQuickReplies && <QuickReplyPicker onPick={handlePickQuickReply} onClose={() => setShowQuickReplies(false)} />}
              {showEmojiPicker && (
                <EmojiPicker
                  onPick={(emoji) => setDraft((prev) => prev + emoji)}
                  onClose={() => setShowEmojiPicker(false)}
                />
              )}

              {pendingQuickReply && (
                <div className="mb-2 flex items-center justify-between rounded-xl border border-brand bg-brand/5 px-3 py-2 text-xs">
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
                  className="rounded-xl border border-gray-300 px-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  📎
                </button>
                <button
                  type="button"
                  onClick={audioRecorder.start}
                  disabled={audioRecorder.state !== "idle"}
                  title="Gravar áudio"
                  className="rounded-xl border border-gray-300 px-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  🎙️
                </button>
                <button
                  type="button"
                  onClick={() => setShowQuickReplies((v) => !v)}
                  title="Respostas rápidas"
                  className="rounded-xl border border-gray-300 px-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  ⚡
                </button>
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker((v) => !v)}
                  title="Emojis"
                  className="rounded-xl border border-gray-300 px-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  😊
                </button>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={pendingQuickReply ? "Edite antes de enviar (opcional)..." : "Digite uma mensagem..."}
                  className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={sending}
                  className="rounded-xl bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
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
