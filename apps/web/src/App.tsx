import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RequireModule } from "./components/RequireModule";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { InboxPage } from "./pages/InboxPage";
import { ContactsPage } from "./pages/ContactsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { KanbanPage } from "./pages/KanbanPage";
import { ConnectWhatsappPage } from "./pages/ConnectWhatsappPage";
import { AutoRepliesPage } from "./pages/AutoRepliesPage";
import { TeamPage } from "./pages/TeamPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LinksPage } from "./pages/LinksPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { CampaignsPage } from "./pages/CampaignsPage";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route element={<RequireModule module="inbox" />}>
              <Route path="/inbox" element={<InboxPage />} />
            </Route>
            <Route element={<RequireModule module="contacts" />}>
              <Route path="/contatos" element={<ContactsPage />} />
            </Route>
            <Route element={<RequireModule module="dashboard" />}>
              <Route path="/dashboard" element={<DashboardPage />} />
            </Route>
            <Route element={<RequireModule module="kanban" />}>
              <Route path="/kanban" element={<KanbanPage />} />
            </Route>
            <Route element={<RequireModule module="autoatendimento" />}>
              <Route path="/autoatendimento" element={<AutoRepliesPage />} />
            </Route>
            <Route element={<RequireModule ownerOrAdminOnly />}>
              <Route path="/whatsapp" element={<ConnectWhatsappPage />} />
              <Route path="/equipe" element={<TeamPage />} />
              <Route path="/configuracoes" element={<SettingsPage />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/campanhas" element={<CampaignsPage />} />
            </Route>
            <Route path="/links" element={<LinksPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Routes>
    </AuthProvider>
  );
}
