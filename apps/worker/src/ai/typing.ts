// Who is typing right now, per WhatsApp session — fed by Baileys' presence updates (see
// session-manager), read by the AI assistant so it doesn't answer while the customer is still
// writing. Kept in memory: the sockets live in this same process, and losing it on a restart just
// means one reply that doesn't wait.
const typingAt = new Map<string, number>();

// WhatsApp repeats "composing" every few seconds while someone types and sends "paused" when they
// stop; an entry older than this is a "paused" we never got (dropped connection, closed app).
const TYPING_STALE_MS = 25_000;

function key(sessionId: string, jid: string) {
  // Presence updates can carry a device suffix ("5511...:12@s.whatsapp.net") the stored jid doesn't.
  return `${sessionId}|${jid.split(":")[0].split("@")[0]}@${jid.split("@")[1]}`;
}

export function setContactPresence(sessionId: string, jid: string, presence: string) {
  if (presence === "composing" || presence === "recording") typingAt.set(key(sessionId, jid), Date.now());
  else typingAt.delete(key(sessionId, jid));
}

export function isContactTyping(sessionId: string, jid: string) {
  const at = typingAt.get(key(sessionId, jid));
  if (at === undefined) return false;
  if (Date.now() - at > TYPING_STALE_MS) {
    typingAt.delete(key(sessionId, jid));
    return false;
  }
  return true;
}
