import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { isAdmin, clearAuth } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Progress } from "@/components/ui/progress"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  BarChart2Icon,
  DatabaseIcon,
  FileTextIcon,
  Loader2Icon,
  LogOutIcon,
  MessageSquareIcon,
  PlayIcon,
  SparklesIcon,
  TrashIcon,
  UploadIcon,
  UserCheckIcon,
  UserXIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"

interface Doc {
  id: string
  filename: string
  chunk_count: number
  created_at: string
}

interface User {
  id: string
  username: string
  email: string
  is_active: boolean
}

export default function AdminPage() {
  const navigate = useNavigate()
  const [docs, setDocs] = useState<Doc[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [uploading, setUploading] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [ingestProgress, setIngestProgress] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Doc | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isAdmin()) {
      navigate("/")
      return
    }
    fetchDocs()
    fetchUsers()
  }, [navigate])

  async function fetchDocs() {
    const { data } = await api.get("/admin/documents")
    setDocs(data)
  }

  async function fetchUsers() {
    const { data } = await api.get("/admin/users")
    setUsers(data)
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    const fd = new FormData()
    for (const f of files) fd.append("files", f)
    try {
      const { data } = await api.post("/admin/upload", fd)
      const count = data.uploaded ?? files.length
      toast.success(`${count} archivo(s) subido(s) correctamente.`)
      await fetchDocs()
    } catch {
      toast.error("Error al subir los archivos.")
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  async function ingest() {
    setIngesting(true)
    setIngestProgress(0)
    const interval = setInterval(() => {
      setIngestProgress((p) => (p !== null && p < 85 ? p + 4 : p))
    }, 700)
    try {
      const { data } = await api.post("/admin/ingest")
      clearInterval(interval)
      setIngestProgress(100)
      const processed = data.processed ?? "?"
      toast.success(`Ingesta completada. ${processed} documento(s) procesado(s).`)
      await fetchDocs()
    } catch {
      clearInterval(interval)
      toast.error("Error durante la ingesta.")
    } finally {
      setIngesting(false)
      setTimeout(() => setIngestProgress(null), 1800)
    }
  }

  async function deleteDoc(id: string) {
    try {
      await api.delete(`/admin/documents/${id}`)
      setDeleteTarget(null)
      toast.success("Documento eliminado correctamente.")
      await fetchDocs()
    } catch {
      toast.error("Error al eliminar el documento.")
    }
  }

  async function toggleUser(id: string, currentActive: boolean) {
    try {
      await api.post(`/admin/users/${id}/toggle`)
      await fetchUsers()
      toast.success(currentActive ? "Usuario suspendido." : "Usuario activado.")
    } catch {
      toast.error("Error al cambiar el estado del usuario.")
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    upload(e.dataTransfer.files)
  }, [])

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-6 py-3 border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-sm">
            <SparklesIcon className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-base">yachAI</span>
          <Badge className="text-xs bg-accent text-accent-foreground border-0">
            Admin
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => navigate("/chat")} />}>
              <MessageSquareIcon />
            </TooltipTrigger>
            <TooltipContent>Chat</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => navigate("/metrics")} />}>
              <BarChart2Icon />
            </TooltipTrigger>
            <TooltipContent>Métricas</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => { clearAuth(); navigate("/") }} />}>
              <LogOutIcon />
            </TooltipTrigger>
            <TooltipContent>Cerrar sesión</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold">Panel de administración</h1>
          <p className="text-sm text-muted-foreground">
            Gestiona los documentos y usuarios de yachAI.
          </p>
        </div>

        <Tabs defaultValue="docs">
          <TabsList className="mb-6">
            <TabsTrigger value="docs" className="gap-1.5">
              <DatabaseIcon className="size-3.5" />
              Documentos
              <Badge variant="secondary" className="text-xs ml-1 px-1.5 py-0">
                {docs.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-1.5">
              <UsersIcon className="size-3.5" />
              Usuarios
              <Badge variant="secondary" className="text-xs ml-1 px-1.5 py-0">
                {users.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          {/* ── Documents tab ── */}
          <TabsContent value="docs" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Subir documentos</CardTitle>
                <CardDescription>
                  Los archivos ya procesados (mismo hash SHA-256) se omiten
                  automáticamente durante la ingesta.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Drop zone */}
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOver(true)
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className={cn(
                    "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all select-none",
                    dragOver
                      ? "border-primary bg-primary/5 scale-[1.01]"
                      : "border-border hover:border-primary/40 hover:bg-muted/40"
                  )}
                >
                  <div className="flex flex-col items-center gap-3">
                    <div
                      className={cn(
                        "w-14 h-14 rounded-2xl flex items-center justify-center transition-colors",
                        dragOver
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      <UploadIcon className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">
                        {dragOver
                          ? "Suelta los archivos aquí"
                          : "Arrastra PDFs aquí o haz clic para seleccionar"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Solo archivos PDF · Múltiples archivos permitidos
                      </p>
                    </div>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => upload(e.target.files)}
                  />
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    variant="outline"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="gap-2"
                  >
                    {uploading ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <UploadIcon className="size-4" />
                    )}
                    {uploading ? "Subiendo…" : "Seleccionar archivos"}
                  </Button>
                  <Button
                    onClick={ingest}
                    disabled={ingesting || docs.length === 0}
                    className="gap-2"
                  >
                    {ingesting ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <PlayIcon className="size-4" />
                    )}
                    {ingesting ? "Procesando…" : "Iniciar ingesta"}
                  </Button>
                </div>

                {/* Progress */}
                {ingestProgress !== null && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {ingestProgress < 100
                          ? "Procesando documentos…"
                          : "¡Ingesta completada!"}
                      </span>
                      <span>{ingestProgress}%</span>
                    </div>
                    <Progress value={ingestProgress} />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Document list */}
            <Card>
              <CardHeader>
                <CardTitle>Documentos indexados</CardTitle>
                <CardDescription>
                  {docs.length === 0
                    ? "No hay documentos. Sube PDFs para comenzar."
                    : `${docs.length} documento(s) disponible(s)`}
                </CardDescription>
              </CardHeader>
              <CardContent className="px-3">
                {docs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-14 gap-3">
                    <div className="w-14 h-14 bg-muted rounded-2xl flex items-center justify-center">
                      <FileTextIcon className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Sube y procesa PDFs para comenzar a usar el chatbot.
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="h-72">
                    <div className="space-y-1 pr-1">
                      {docs.map((d) => (
                        <div
                          key={d.id}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors group"
                        >
                          <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                            <FileTextIcon className="w-4 h-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {d.filename}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {d.chunk_count} fragmentos ·{" "}
                              {new Date(d.created_at).toLocaleDateString(
                                "es-EC"
                              )}
                            </p>
                          </div>
                          <Dialog
                            open={deleteTarget?.id === d.id}
                            onOpenChange={(open) =>
                              !open && setDeleteTarget(null)
                            }
                          >
                            <DialogTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10 transition-opacity"
                                  onClick={() => setDeleteTarget(d)}
                                />
                              }
                            >
                              <TrashIcon />
                            </DialogTrigger>
                            <DialogContent showCloseButton={false}>
                              <DialogHeader>
                                <DialogTitle>Eliminar documento</DialogTitle>
                                <DialogDescription>
                                  ¿Seguro que deseas eliminar{" "}
                                  <strong>{d.filename}</strong>? Se eliminarán
                                  todos sus fragmentos del índice vectorial.
                                  Esta acción no se puede deshacer.
                                </DialogDescription>
                              </DialogHeader>
                              <DialogFooter>
                                <Button
                                  variant="outline"
                                  onClick={() => setDeleteTarget(null)}
                                >
                                  Cancelar
                                </Button>
                                <Button
                                  variant="destructive"
                                  onClick={() => deleteDoc(d.id)}
                                >
                                  Eliminar
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Users tab ── */}
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle>Gestión de usuarios</CardTitle>
                <CardDescription>
                  {users.length} usuario(s) registrado(s). Los administradores
                  se gestionan únicamente desde el archivo .env.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-3">
                <ScrollArea className="h-96">
                  <div className="space-y-1 pr-1">
                    {users.map((u) => (
                      <div
                        key={u.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="w-9 h-9 bg-accent/20 rounded-full flex items-center justify-center shrink-0">
                          <span className="text-sm font-bold text-foreground">
                            {u.username[0].toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{u.username}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {u.email}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge
                            variant={u.is_active ? "default" : "secondary"}
                            className={cn(
                              "text-xs",
                              u.is_active &&
                                "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0"
                            )}
                          >
                            {u.is_active ? "Activo" : "Suspendido"}
                          </Badge>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => toggleUser(u.id, u.is_active)}
                                  className={u.is_active ? "text-destructive hover:bg-destructive/10" : "text-primary hover:bg-primary/10"}
                                />
                              }
                            >
                              {u.is_active ? <UserXIcon /> : <UserCheckIcon />}
                            </TooltipTrigger>
                            <TooltipContent>
                              {u.is_active
                                ? "Suspender usuario"
                                : "Activar usuario"}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
