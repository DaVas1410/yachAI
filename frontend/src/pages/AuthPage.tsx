import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { saveAuth } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { BookOpenIcon, GraduationCapIcon, Loader2Icon, SparklesIcon, ShieldCheckIcon } from "lucide-react"

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login")
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const body =
        mode === "login"
          ? { username, password }
          : { username, email, password }
      const { data } = await api.post(`/auth/${mode}`, body)
      saveAuth(data.access_token, data.is_admin)
      navigate(data.is_admin ? "/admin" : "/chat")
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? "Error al conectar con el servidor."
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const features = [
    { icon: BookOpenIcon, text: "Más de 160 documentos institucionales indexados" },
    { icon: SparklesIcon, text: "Respuestas en español con contexto exacto" },
    { icon: ShieldCheckIcon, text: "IA local — tus consultas no salen de la universidad" },
  ]

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel: Yachay Tech branding ── */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary flex-col justify-between p-12 relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute top-0 right-0 w-[480px] h-[480px] rounded-full bg-white/5 -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full bg-accent/15 translate-y-1/2 -translate-x-1/3 pointer-events-none" />
        <div className="absolute bottom-1/3 right-1/4 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center shadow-lg">
            <SparklesIcon className="w-5 h-5 text-accent-foreground" />
          </div>
          <span className="text-2xl font-bold text-primary-foreground tracking-tight">yachAI</span>
        </div>

        {/* Hero text */}
        <div className="relative z-10 space-y-8">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <GraduationCapIcon className="w-4 h-4 text-accent" />
              <span className="text-accent text-sm font-semibold uppercase tracking-widest">
                Yachay Tech University
              </span>
            </div>
            <h1 className="text-4xl font-bold text-primary-foreground leading-snug">
              Consulta los documentos institucionales con IA
            </h1>
            <p className="text-primary-foreground/70 text-lg leading-relaxed">
              Accede a reglamentos, procedimientos y políticas de la UITEY de forma rápida e inteligente.
            </p>
          </div>

          <div className="space-y-3">
            {features.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 text-primary-foreground/80">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-sm">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="relative z-10 text-primary-foreground/40 text-xs">
          Universidad de Investigación de Tecnología Experimental Yachay · Urcuquí, Ecuador
        </p>
      </div>

      {/* ── Right panel: Form ── */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-sm space-y-7">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 justify-center">
            <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center">
              <SparklesIcon className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold tracking-tight">yachAI</span>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold tracking-tight">
              {mode === "login" ? "Bienvenido de vuelta" : "Crea tu cuenta"}
            </h2>
            <p className="text-muted-foreground text-sm">
              {mode === "login"
                ? "Ingresa tus credenciales para acceder al sistema."
                : "Regístrate para consultar los documentos institucionales."}
            </p>
          </div>

          {/* Mode toggle */}
          <div className="flex bg-muted rounded-xl p-1 gap-1">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m)
                  setError("")
                }}
                className={cn(
                  "flex-1 py-2 text-sm font-medium rounded-lg transition-all",
                  mode === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m === "login" ? "Iniciar sesión" : "Registrarse"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Usuario</Label>
              <Input
                id="username"
                placeholder="tu_usuario"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
              />
            </div>

            {mode === "register" && (
              <div className="space-y-1.5">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="correo@yachaytech.edu.ec"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>

            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" className="w-full gap-2" disabled={loading}>
              {loading && <Loader2Icon className="size-4 animate-spin" />}
              {loading
                ? "Cargando..."
                : mode === "login"
                  ? "Iniciar sesión"
                  : "Crear cuenta"}
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            UITEY · Urcuquí, Ecuador
          </p>
        </div>
      </div>
    </div>
  )
}
