import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { InboxPage } from "./pages/InboxPage";
import { KanbanPage } from "./pages/KanbanPage";
import { ConnectWhatsappPage } from "./pages/ConnectWhatsappPage";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/kanban" element={<KanbanPage />} />
            <Route path="/whatsapp" element={<ConnectWhatsappPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Routes>
    </AuthProvider>
  );
}
