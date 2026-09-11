import { FormEvent, useEffect, useState } from "react";
import { MODULE_KEYS, MODULE_LABELS, ModuleKey, Role } from "@crm/shared";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Icon } from "../components/Icon";

const roleBadgeTone: Record<Role, string> = {
  [Role.OWNER]: "bg-brand/10 text-brand-dark",
  [Role.ADMIN]: "bg-blue-50 text-blue-600",
  [Role.AGENT]: "bg-gray-100 text-gray-600",
};

interface TeamMember {
  membershipId: string;
  id: string;
  name: string;
  email: string;
  role: Role;
  allowedModules: string[];
}

const roleLabel: Record<Role, string> = {
  [Role.OWNER]: "Dono(a)",
  [Role.ADMIN]: "Administrador(a)",
  [Role.AGENT]: "Atendente",
};

function ModuleCheckboxes({ selected, onToggle }: { selected: Set<string>; onToggle: (key: ModuleKey) => void }) {
  return (
    <div className="flex flex-wrap gap-3">
      {MODULE_KEYS.map((key) => (
        <label key={key} className="flex items-center gap-1.5 text-xs text-gray-700">
          <input type="checkbox" checked={selected.has(key)} onChange={() => onToggle(key)} />
          {MODULE_LABELS[key]}
        </label>
      ))}
    </div>
  );
}

export function TeamPage() {
  const { user, organization } = useAuth();
  const canManage = organization?.role === Role.OWNER || organization?.role === Role.ADMIN;

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(Role.AGENT);
  const [newAllowedModules, setNewAllowedModules] = useState<Set<string>>(new Set(MODULE_KEYS));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingAccessFor, setEditingAccessFor] = useState<string | null>(null);

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
    setNewAllowedModules(new Set(MODULE_KEYS));
    setError(null);
    setShowForm(false);
  }

  function toggleNewModule(key: ModuleKey) {
    setNewAllowedModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || password.length < 8) return;
    setCreating(true);
    setError(null);
    try {
      await api.post("/team", {
        name: name.trim(),
        email: email.trim(),
        password,
        role,
        allowedModules: Array.from(newAllowedModules),
      });
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

  async function handleToggleMemberModule(member: TeamMember, key: ModuleKey) {
    const nextModules = new Set(member.allowedModules);
    if (nextModules.has(key)) nextModules.delete(key);
    else nextModules.add(key);
    const allowedModules = Array.from(nextModules);

    setMembers((prev) => prev.map((m) => (m.membershipId === member.membershipId ? { ...m, allowedModules } : m)));
    try {
      await api.patch(`/team/${member.membershipId}`, { allowedModules });
    } catch {
      await refresh();
    }
  }

  async function handleRemove(membershipId: string) {
    await api.delete(`/team/${membershipId}`);
    await refresh();
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">Equipe</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Pessoas com acesso a esta organização. Remover alguém da equipe não apaga nada que essa pessoa já fez —
          mensagens, negócios e anotações continuam com o nome dela. Dono(a) e Administrador(a) sempre veem tudo;
          o acesso por área abaixo só se aplica a Atendentes.
        </p>
      </div>

      <div className="max-w-2xl space-y-2">
        {members.map((member) => (
          <div key={member.membershipId} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-600">
                  {member.name.charAt(0).toUpperCase()}
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {member.name} {member.id === user?.id && <span className="text-xs text-gray-400">(você)</span>}
                  </p>
                  <p className="text-xs text-gray-500">{member.email}</p>
                </div>
              </div>
              {canManage && member.id !== user?.id ? (
                <div className="flex items-center gap-3">
                  <select
                    value={member.role}
                    onChange={(e) => handleRoleChange(member.membershipId, e.target.value as Role)}
                    className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:border-brand focus:outline-none"
                  >
                    <option value={Role.AGENT}>Atendente</option>
                    <option value={Role.ADMIN}>Administrador(a)</option>
                    <option value={Role.OWNER}>Dono(a)</option>
                  </select>
                  {member.role === Role.AGENT && (
                    <button
                      onClick={() => setEditingAccessFor((v) => (v === member.membershipId ? null : member.membershipId))}
                      className="text-xs font-medium text-brand-dark hover:underline"
                    >
                      Acesso
                    </button>
                  )}
                  <button onClick={() => handleRemove(member.membershipId)} className="text-xs font-medium text-red-600 hover:underline">
                    Remover
                  </button>
                </div>
              ) : (
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${roleBadgeTone[member.role]}`}>
                  {roleLabel[member.role]}
                </span>
              )}
            </div>
            {member.role === Role.AGENT && editingAccessFor === member.membershipId && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <p className="mb-2 text-xs font-medium text-gray-600">Pode acessar:</p>
                <ModuleCheckboxes
                  selected={new Set(member.allowedModules)}
                  onToggle={(key) => handleToggleMemberModule(member, key)}
                />
              </div>
            )}
          </div>
        ))}
        {members.length === 0 && (
          <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-400">
            Nenhum membro encontrado.
          </p>
        )}
      </div>

      {canManage && (
        <div className="mt-4 max-w-2xl">
          {showForm ? (
            <form onSubmit={handleCreate} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-900">Adicionar funcionário(a)</p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome"
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="E-mail (será o login dessa pessoa)"
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Senha inicial (mínimo 8 caracteres)"
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              >
                <option value={Role.AGENT}>Atendente</option>
                <option value={Role.ADMIN}>Administrador(a)</option>
              </select>
              {role === Role.AGENT && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-gray-600">Pode acessar:</p>
                  <ModuleCheckboxes selected={newAllowedModules} onToggle={toggleNewModule} />
                </div>
              )}
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={resetForm} className="rounded-xl px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating || !name.trim() || !email.trim() || password.length < 8}
                  className="rounded-xl bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  Adicionar
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 rounded-xl bg-brand-dark px-3 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90"
            >
              <Icon name="plus" className="h-4 w-4" />
              Adicionar funcionário
            </button>
          )}
        </div>
      )}
    </div>
  );
}
