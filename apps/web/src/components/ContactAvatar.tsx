interface AvatarContact {
  name: string | null;
  phoneNumber: string;
  avatarUrl?: string | null;
}

export function contactLabel(contact: AvatarContact) {
  return contact.name?.trim() || `+${contact.phoneNumber}`;
}

export function ContactAvatar({ contact, size = 36 }: { contact: AvatarContact; size?: number }) {
  const style = { width: size, height: size };
  if (contact.avatarUrl) {
    return <img src={contact.avatarUrl} alt="" style={style} className="flex-shrink-0 rounded-full object-cover" />;
  }
  return (
    <div
      style={style}
      className="flex flex-shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand-dark"
    >
      {contactLabel(contact).slice(0, 1).toUpperCase()}
    </div>
  );
}
