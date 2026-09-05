import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute() {
  const { token, loading } = useAuth();

  if (loading) return <div className="flex h-full items-center justify-center text-gray-500">Carregando...</div>;
  if (!token) return <Navigate to="/login" replace />;

  return <Outlet />;
}
