import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import AuthPage from "@/pages/AuthPage"
import ChatPage from "@/pages/ChatPage"
import AdminPage from "@/pages/AdminPage"
import MetricsPage from "@/pages/MetricsPage"
import { isLoggedIn, isAdmin } from "@/lib/auth"

function RequireAuth({ children }: { children: React.ReactElement }) {
  return isLoggedIn() ? children : <Navigate to="/" replace />
}

function RequireAdmin({ children }: { children: React.ReactElement }) {
  return isAdmin() ? children : <Navigate to="/chat" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AuthPage />} />
        <Route path="/chat" element={<RequireAuth><ChatPage /></RequireAuth>} />
        <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
        <Route path="/metrics" element={<RequireAuth><MetricsPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
