import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { isAdmin } from "@/lib/auth"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  BarChart2Icon,
  BotIcon,
  Loader2Icon,
  SendIcon,
  ShieldIcon,
  SparklesIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UserIcon,
} from "lucide-react"
import { toast } from "sonner"

interface Message {
  role: "user" | "assistant"
  content: string
  metric_id?: string
  feedback?: "up" | "down"
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const navigate = useNavigate()
  const admin = isAdmin()

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8000/chat/ws")
    wsRef.current = ws

    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data)
      if (data.type === "chunk") {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last?.role === "assistant") {
            return [
              ...prev.slice(0, -1),
              { ...last, content: last.content + data.text },
            ]
          }
          return [...prev, { role: "assistant", content: data.text }]
        })
      } else if (data.type === "done") {
        setStreaming(false)
        if (data.metric_id) {
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last?.role === "assistant") {
              return [
                ...prev.slice(0, -1),
                { ...last, metric_id: data.metric_id },
              ]
            }
            return prev
          })
        }
      } else if (data.type === "error") {
        setStreaming(false)
        toast.error("Error al procesar la consulta.")
      }
    }

    return () => ws.close()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  function send() {
    const text = input.trim()
    if (!text || streaming || !wsRef.current) return
    setMessages((prev) => [...prev, { role: "user", content: text }])
    wsRef.current.send(JSON.stringify({ query: text }))
    setInput("")
    setStreaming(true)
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function adjustTextarea(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    e.target.style.height = "auto"
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
  }

  async function sendFeedback(msgIdx: number, vote: "up" | "down") {
    const msg = messages[msgIdx]
    if (!msg?.metric_id || msg.feedback) return
    try {
      await api.post("/metrics/feedback", { metric_id: msg.metric_id, vote })
      setMessages((prev) =>
        prev.map((m, i) => (i === msgIdx ? { ...m, feedback: vote } : m))
      )
      toast.success(
        vote === "up" ? "¡Gracias por tu valoración!" : "Gracias, seguiremos mejorando."
      )
    } catch {
      toast.error("No se pudo enviar la valoración.")
    }
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-sm">
            <SparklesIcon className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-base">yachAI</span>
          <Badge variant="secondary" className="text-xs hidden sm:inline-flex">
            Yachay Tech
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => navigate("/metrics")} />}>
              <BarChart2Icon />
            </TooltipTrigger>
            <TooltipContent>Métricas</TooltipContent>
          </Tooltip>

          {admin && (
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => navigate("/admin")} />}>
                <ShieldIcon />
              </TooltipTrigger>
              <TooltipContent>Panel de administración</TooltipContent>
            </Tooltip>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
              <UserIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => navigate("/metrics")}>
                <BarChart2Icon className="mr-2 size-4" />
                Métricas
              </DropdownMenuItem>
              {admin && (
                <DropdownMenuItem onClick={() => navigate("/admin")}>
                  <ShieldIcon className="mr-2 size-4" />
                  Administración
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* ── Messages ── */}
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 text-center">
              <div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center ring-1 ring-primary/20">
                <SparklesIcon className="w-9 h-9 text-primary" />
              </div>
              <div className="space-y-1.5 max-w-xs">
                <p className="text-lg font-semibold">¿En qué puedo ayudarte?</p>
                <p className="text-sm text-muted-foreground">
                  Pregunta sobre reglamentos, procedimientos o políticas de
                  Yachay Tech University.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-sm">
                {[
                  "¿Cuáles son los requisitos de graduación?",
                  "¿Cómo solicitar una beca?",
                  "¿Cuál es el reglamento de evaluaciones?",
                  "¿Cómo registrar materias?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setInput(q)
                      textareaRef.current?.focus()
                    }}
                    className="text-left px-3 py-2.5 rounded-xl border bg-card hover:bg-muted/60 transition-colors text-xs text-muted-foreground hover:text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "flex gap-3",
                m.role === "user" ? "flex-row-reverse" : "flex-row"
              )}
            >
              {/* Avatar */}
              <Avatar size="sm" className="shrink-0 mt-0.5">
                {m.role === "user" ? (
                  <AvatarFallback className="bg-accent text-accent-foreground font-semibold">
                    <UserIcon className="w-3.5 h-3.5" />
                  </AvatarFallback>
                ) : (
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    <BotIcon className="w-3.5 h-3.5" />
                  </AvatarFallback>
                )}
              </Avatar>

              <div
                className={cn(
                  "flex flex-col gap-1.5",
                  m.role === "user" ? "items-end" : "items-start"
                )}
              >
                <div
                  className={cn(
                    "rounded-2xl px-4 py-2.5 max-w-prose text-sm leading-relaxed whitespace-pre-wrap",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-card ring-1 ring-foreground/8 text-foreground rounded-tl-sm"
                  )}
                >
                  {m.content}
                </div>

                {/* Feedback */}
                {m.role === "assistant" && m.metric_id && !streaming && (
                  <div className="flex gap-0.5">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className={cn("rounded-lg", m.feedback === "up" && "text-primary bg-primary/10 hover:bg-primary/15")}
                            onClick={() => sendFeedback(i, "up")}
                            disabled={!!m.feedback}
                          />
                        }
                      >
                        <ThumbsUpIcon />
                      </TooltipTrigger>
                      <TooltipContent>Buena respuesta</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className={cn("rounded-lg", m.feedback === "down" && "text-destructive bg-destructive/10 hover:bg-destructive/15")}
                            onClick={() => sendFeedback(i, "down")}
                            disabled={!!m.feedback}
                          />
                        }
                      >
                        <ThumbsDownIcon />
                      </TooltipTrigger>
                      <TooltipContent>Respuesta incorrecta</TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {streaming && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex gap-3">
              <Avatar size="sm" className="shrink-0 mt-0.5">
                <AvatarFallback className="bg-primary text-primary-foreground">
                  <BotIcon className="w-3.5 h-3.5" />
                </AvatarFallback>
              </Avatar>
              <div className="bg-card ring-1 ring-foreground/8 rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex gap-1 items-center h-4">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* ── Input area ── */}
      <div className="border-t bg-card/50 backdrop-blur-sm px-4 py-3 shrink-0">
        <div className="max-w-2xl mx-auto">
          <div className="flex gap-2 items-end bg-background rounded-xl border shadow-sm px-3 py-2 focus-within:ring-2 focus-within:ring-ring/50 focus-within:border-ring transition-all">
            <Textarea
              ref={textareaRef}
              placeholder="Escribe tu pregunta… (Shift+Enter para nueva línea)"
              value={input}
              onChange={adjustTextarea}
              onKeyDown={handleKeyDown}
              disabled={streaming}
              rows={1}
              className="resize-none border-0 shadow-none focus-visible:ring-0 p-0 min-h-[1.5rem] max-h-40 bg-transparent field-sizing-normal text-sm"
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    onClick={send}
                    disabled={streaming || !input.trim()}
                    className="shrink-0 rounded-lg"
                  />
                }
              >
                {streaming ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
              </TooltipTrigger>
              <TooltipContent>Enviar (Enter)</TooltipContent>
            </Tooltip>
          </div>
          <p className="text-[11px] text-muted-foreground text-center mt-1.5">
            yachAI puede cometer errores. Verifica la información importante en los documentos originales.
          </p>
        </div>
      </div>
    </div>
  )
}
