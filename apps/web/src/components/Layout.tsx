import { NavLink, Outlet } from "react-router-dom";
import { ModuleKey, Role } from "@crm/shared";
import { useAuth } from "../context/AuthContext";

const navItems: { to: string; label: string; module?: ModuleKey; ownerOrAdminOnly?: boolean }[] = [
  { to: "/inbox", label: "Caixa de Entrada", module: "inbox" },
  { to: "/kanban", label: "Funil", module: "kanban" },
  { to: "/autoatendimento", label: "Autoatendimento", module: "autoatendimento" },
  { to: "/whatsapp", label: "Conexão WhatsApp", ownerOrAdminOnly: true },
  { to: "/equipe", label: "Equipe", ownerOrAdminOnly: true },
];

export function Layout() {
  const { organization, user, logout } = useAuth();

  const visibleNavItems = navItems.filter((item) => {
    if (item.ownerOrAdminOnly) return organization?.role === Role.OWNER || organization?.role === Role.ADMIN;
    if (item.module) return organization?.allowedModules.includes(item.module) ?? false;
    return true;
  });

  return (
    <div className="flex h-screen w-screen bg-gray-50 text-gray-900">
      <aside className="flex w-56 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-4">
          <p className="text-sm font-semibold text-brand-dark">CRM WhatsApp</p>
          <p className="truncate text-xs text-gray-500">{organization?.name}</p>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm font-medium ${
                  isActive ? "bg-brand/10 text-brand-dark" : "text-gray-600 hover:bg-gray-100"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-gray-200 p-3">
          <p className="truncate text-xs text-gray-500">{user?.email}</p>
          <button onClick={logout} className="mt-2 text-xs font-medium text-red-600 hover:underline">
            Sair
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
