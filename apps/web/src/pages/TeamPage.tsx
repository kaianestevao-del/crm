import { FormEvent, useEffect, useState } from "react";
import { Role } from "@crm/shared";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface TeamMember {
  membershipId: string;
  id: string;
  name: string;
  email: string;
  role: Role;
}

const roleLabel: Record<Role, string> = {
  [Role.OWNER]: "Dono(a)",
  [Role.ADMIN]: "Administrador(a)",
  [Role.AGENT]: "Atendente",
};

export function TeamPage() {
  const { user, organization } = useAuth();
  const canManage = organization?.role === Role.OWNER || organization?.role === Role.ADMIN;

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(Role.AGENT);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await api.get("/team");
    setMembers(res.data);
  }

  useEffect(() => {
    refresh();
  }, []);

  function resetForm() {
    setName("");
    setEmail("");
    setPassword("");
    setRole(Role.AGENT);
    setError(null);
    setShowForm(false);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || password.length < 8) return;
    setCreating(true);
    setError(null);
    try {
      await api.post("/team", { name: name.trim(), email: email.trim(), password, role });
      resetForm();
      await refresh();
    } catch (err: any) {
      const code = err?.response?.data?.error;
      if (code === "already_a_team_member") setError("Esse e-mail já faz parte da equipe.");
      else if (code === "email_already_registered_elsewhere") setError("Esse e-mail já está cadastrado em outra organização.");
      else setError("Não foi possível adicionar o funcionário.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRoleChange(membershipId: string, newRole: Role) {
    setMembers((prev) => prev.map((m) => (m.membershipId === membershipId ? { ...m, role: newRole } : m)));
    try {
      await api.patch(`/team/${membershipId}`, { role: newRole });
    } catch {
      await refresh();
    }
  }

  async function handleRemove(membershipId: string) {
    await api.delete(`/team/${membershipId}`);
    await refresh();
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-1 text-lg font-semibold">Equipe</h1>
      <p className="mb-6 max-w-2xl text-sm text-gray-500">
        Pessoas com acesso a esta organização. Remover alguém da equipe não apaga nada que essa pessoa já fez —
        mensagens, negócios e anotações continuam com o nome dela.
      </p>

      <div className="max-w-2xl rounded-lg border border-gray-200 bg-white">
        {members.map((member) => (
          <div key={member.membershipId} className="flex items-center justify-between border-b border-gray-100 px-4 py-3 last:border-b-0">
            <div>
              <p className="text-sm font-medium">
                {member.name} {member.id === user?.id && <span className="text-xs text-gray-400">(você)</span>}
              </p>
              <p className="text-xs text-gray-500">{member.email}</p>
            </div>
            {canManage && member.id !== user?.id ? (
              <div className="flex items-center gap-3">
                <select
                  value={member.role}
                  onChange={(e) => handleRoleChange(member.membershipId, e.target.value as Role)}
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-brand focus:outline-none"
                >
                  <option value={Role.AGENT}>Atendente</option>
                  <option value={Role.ADMIN}>Administrador(a)</option>
                  <option value={Role.OWNER}>Dono(a)</option>
                </select>
                <button onClick={() => handleRemove(member.membershipId)} className="text-xs font-medium text-red-600 hover:underline">
                  Remover
                </button>
              </div>
            ) : (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{roleLabel[member.role]}</span>
            )}
          </div>
        ))}
        {members.length === 0 && <p className="p-4 text-sm text-gray-400">Nenhum membro encontrado.</p>}
      </div>

      {canManage && (
        <div className="mt-4 max-w-2xl">
          {showForm ? (
            <form onSubmit={handleCreate} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-medium">Adicionar funcionário(a)</p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="E-mail (será o login dessa pessoa)"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Senha inicial (mínimo 8 caracteres)"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              >
                <option value={Role.AGENT}>Atendente</option>
                <option value={Role.ADMIN}>Administrador(a)</option>
              </select>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={resetForm} className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating || !name.trim() || !email.trim() || password.length < 8}
                  className="rounded-md bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  Adicionar
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="rounded-md bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              + Adicionar funcionário
            </button>
          )}
        </div>
      )}
    </div>
  );
}
