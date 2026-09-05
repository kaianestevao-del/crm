import { FormEvent, useEffect, useRef, useState } from "react";
import { MessageDirection } from "@crm/shared";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";

interface Contact {
  id: string;
  name: string | null;
  phoneNumber: string;
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
  content: string | null;
  createdAt: string;
}

function contactLabel(contact: Contact) {
  return contact.name?.trim() || `+${contact.phoneNumber}`;
}

export function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function refreshConversations() {
    const res = await api.get("/conversations");
    setConversations(res.data);
  }

  useEffect(() => {
    refreshConversations();
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onNewMessage = (evt: { conversationId: string; message: Message }) => {
      if (evt.conversationId === selectedId) {
        setMessages((prev) => [...prev, evt.message]);
      }
    };
    const onConversationUpdated = () => {
      refreshConversations();
    };

    socket.on("message.new", onNewMessage);
    socket.on("conversation.updated", onConversationUpdated);
    return () => {
      socket.off("message.new", onNewMessage);
      socket.off("conversation.updated", onConversationUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function selectConversation(id: string) {
    setSelectedId(id);
    const res = await api.get(`/conversations/${id}/messages`);
    setMessages(res.data);
    await api.post(`/conversations/${id}/read`);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    try {
      const res = await api.post(`/conversations/${selectedId}/messages`, { text: draft.trim() });
      setMessages((prev) => [...prev, res.data]);
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      <div className="w-80 overflow-y-auto border-r border-gray-200 bg-white">
        {conversations.map((conversation) => (
          <button
            key={conversation.id}
            onClick={() => selectConversation(conversation.id)}
            className={`block w-full border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50 ${
              selectedId === conversation.id ? "bg-brand/5" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="truncate text-sm font-medium">{contactLabel(conversation.contact)}</p>
              {conversation.unreadCount > 0 && (
                <span className="rounded-full bg-brand-dark px-2 py-0.5 text-xs font-medium text-white">
                  {conversation.unreadCount}
                </span>
              )}
            </div>
            <p className="truncate text-xs text-gray-500">{conversation.messages[0]?.content ?? "Sem mensagens"}</p>
          </button>
        ))}
        {conversations.length === 0 && <p className="p-4 text-sm text-gray-500">Nenhuma conversa ainda.</p>}
      </div>

      <div className="flex flex-1 flex-col">
        {selectedConversation ? (
          <>
            <div className="border-b border-gray-200 bg-white px-4 py-3">
              <p className="font-medium">{contactLabel(selectedConversation.contact)}</p>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto bg-gray-50 p-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-md rounded-lg px-3 py-2 text-sm ${
                    message.direction === MessageDirection.OUTBOUND
                      ? "ml-auto bg-brand-dark text-white"
                      : "bg-white text-gray-900 shadow-sm"
                  }`}
                >
                  {message.content}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={handleSend} className="flex gap-2 border-t border-gray-200 bg-white p-3">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Digite uma mensagem..."
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending}
                className="rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                Enviar
              </button>
            </form>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
            Selecione uma conversa para começar
          </div>
        )}
      </div>
    </div>
  );
}
