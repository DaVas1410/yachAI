import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { saveAdminToken } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SparklesIcon } from "lucide-react"
import { toast } from "sonner"

export default function AdminLoginPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await api.post("/auth/login", { username, password })
      saveAdminToken(data.access_token)
      navigate("/admin")
    } catch {
      toast.error("Credenciales inválidas.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-sm">
            <SparklesIcon className="w-5 h-5 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-semibold">Panel de administración</h1>
          <p className="text-sm text-muted-foreground">Acceso restringido</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="username">Usuario</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Iniciando sesión…" : "Iniciar sesión"}
          </Button>
        </form>

        <div className="text-center">
          <button
            type="button"
            onClick={() => navigate("/chat")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Volver al chat
          </button>
        </div>
      </div>
    </div>
  )
}
