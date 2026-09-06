import { Outlet } from "react-router-dom";
import { ModuleKey, Role } from "@crm/shared";
import { useAuth } from "../context/AuthContext";

function NoAccess() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div>
        <p className="mb-1 text-sm font-medium text-gray-700">Sem acesso a esta área</p>
        <p className="text-sm text-gray-500">Fale com o administrador da sua organização se achar que deveria ter acesso.</p>
      </div>
    </div>
  );
}

export function RequireModule({ module, ownerOrAdminOnly }: { module?: ModuleKey; ownerOrAdminOnly?: boolean }) {
  const { organization } = useAuth();

  const allowed = ownerOrAdminOnly
    ? organization?.role === Role.OWNER || organization?.role === Role.ADMIN
    : module
      ? (organization?.allowedModules.includes(module) ?? false)
      : true;

  if (!allowed) return <NoAccess />;
  return <Outlet />;
}
