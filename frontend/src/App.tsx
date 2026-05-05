import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import ChatPage from "@/pages/ChatPage"
import AdminPage from "@/pages/AdminPage"
import AdminLoginPage from "@/pages/AdminLoginPage"
import MetricsPage from "@/pages/MetricsPage"
import { isAdmin } from "@/lib/auth"

function RequireAdmin({ children }: { children: React.ReactElement }) {
  return isAdmin() ? children : <Navigate to="/admin/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/metrics" element={<MetricsPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
