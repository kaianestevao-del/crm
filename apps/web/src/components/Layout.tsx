import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ModuleKey, Role } from "@crm/shared";
import { useAuth } from "../context/AuthContext";
import { Icon, IconName } from "./Icon";
import { ChangePasswordModal } from "./ChangePasswordModal";

const navItems: { to: string; label: string; icon: IconName; module?: ModuleKey; ownerOrAdminOnly?: boolean }[] = [
  { to: "/inbox", label: "Caixa de Entrada", icon: "chat", module: "inbox" },
  { to: "/contatos", label: "Contatos", icon: "users", module: "contacts" },
  { to: "/dashboard", label: "Dashboard", icon: "grid", module: "dashboard" },
  { to: "/kanban", label: "Funil", icon: "columns", module: "kanban" },
  { to: "/autoatendimento", label: "Autoatendimento", icon: "bot", module: "autoatendimento" },
  { to: "/whatsapp", label: "Conexão WhatsApp", icon: "phone", ownerOrAdminOnly: true },
  { to: "/equipe", label: "Equipe", icon: "team", ownerOrAdminOnly: true },
  { to: "/configuracoes", label: "Configurações", icon: "settings", ownerOrAdminOnly: true },
  { to: "/links", label: "Links & Contatos", icon: "link" },
  { to: "/campanhas", label: "Campanhas", icon: "megaphone", ownerOrAdminOnly: true },
  { to: "/templates", label: "Templates", icon: "tag", ownerOrAdminOnly: true },
];

export function Layout() {
  const { organization, user, logout } = useAuth();
  const [showChangePassword, setShowChangePassword] = useState(false);

  const visibleNavItems = navItems.filter((item) => {
    if (item.ownerOrAdminOnly) return organization?.role === Role.OWNER || organization?.role === Role.ADMIN;
    if (item.module) return organization?.allowedModules.includes(item.module) ?? false;
    return true;
  });

  return (
    <div className="flex h-screen w-screen bg-gray-50 text-gray-900">
      <aside className="flex w-60 flex-col border-r border-gray-200 bg-white">
        <div className="flex items-center gap-2.5 border-b border-gray-100 px-4 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-base font-bold text-white shadow-sm">
            W
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">CRM WhatsApp</p>
            <p className="truncate text-xs text-gray-500">{organization?.name}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? "bg-brand text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={item.icon} className={`h-4 w-4 shrink-0 ${isActive ? "text-white" : "text-gray-400"}`} />
                  <span className="truncate">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-gray-100 p-3">
          <div className="flex items-center gap-2.5 rounded-xl px-1 py-1.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
              {(user?.email ?? "?").charAt(0).toUpperCase()}
            </span>
            <p className="truncate text-xs text-gray-500">{user?.email}</p>
          </div>
          <button
            onClick={() => setShowChangePassword(true)}
            className="mt-1 w-full rounded-xl px-3 py-1.5 text-left text-xs font-medium text-gray-500 hover:bg-gray-100"
          >
            🔑 Trocar senha
          </button>
          <button
            onClick={logout}
            className="w-full rounded-xl px-3 py-1.5 text-left text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Sair
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-hidden bg-gray-50">
        <Outlet />
      </main>
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
}
