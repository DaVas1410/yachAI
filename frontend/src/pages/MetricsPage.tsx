import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { isLoggedIn } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import EmbeddingScene from "@/components/EmbeddingScene"
import {
  ActivityIcon,
  ArrowLeftIcon,
  BarChart2Icon,
  ClockIcon,
  Loader2Icon,
  SparklesIcon,
  TargetIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react"

interface Stats {
  total_queries: number
  avg_latency_ms: number
  avg_retrieval_score: number
  thumbs_up: number
  thumbs_down: number
}

interface EmbPoint {
  x: number
  y: number
  z: number
  is_query?: boolean
}

export default function MetricsPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [points, setPoints] = useState<EmbPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isLoggedIn()) {
      navigate("/")
      return
    }
    Promise.all([
      api.get("/metrics/stats"),
      api.get("/metrics/embeddings"),
    ])
      .then(([statsRes, pointsRes]) => {
        setStats(statsRes.data)
        setPoints(pointsRes.data)
      })
      .finally(() => setLoading(false))
  }, [navigate])

  const pct =
    stats && stats.thumbs_up + stats.thumbs_down > 0
      ? Math.round(
          (stats.thumbs_up / (stats.thumbs_up + stats.thumbs_down)) * 100
        )
      : null

  const chunkCount = points.filter((p) => !p.is_query).length
  const queryCount = points.filter((p) => p.is_query).length

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-6 py-3 border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-sm">
            <SparklesIcon className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-base">yachAI</span>
          <span className="text-muted-foreground/60 text-sm">·</span>
          <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <BarChart2Icon className="w-3.5 h-3.5" />
            Métricas
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="sm" onClick={() => navigate("/chat")} className="gap-1.5" />}>
            <ArrowLeftIcon className="w-4 h-4" />
            Volver al chat
          </TooltipTrigger>
          <TooltipContent>Volver al chat</TooltipContent>
        </Tooltip>
      </header>

      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold">Métricas del sistema RAG</h1>
          <p className="text-sm text-muted-foreground">
            Rendimiento y calidad de las respuestas generadas por yachAI.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2Icon className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* ── Stat cards ── */}
            {stats && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  title="Total consultas"
                  value={String(stats.total_queries)}
                  icon={<ActivityIcon />}
                  colorClass="bg-primary/10 text-primary"
                />
                <StatCard
                  title="Latencia media"
                  value={`${Math.round(stats.avg_latency_ms)} ms`}
                  icon={<ClockIcon />}
                  colorClass="bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                />
                <StatCard
                  title="Score medio"
                  value={stats.avg_retrieval_score.toFixed(3)}
                  icon={<TargetIcon />}
                  colorClass="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                />
                <StatCard
                  title="Satisfacción"
                  value={pct !== null ? `${pct}%` : "—"}
                  icon={<ThumbsUpIcon />}
                  colorClass="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                  sub={
                    <div className="flex items-center gap-2 mt-1">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <ThumbsUpIcon className="w-3 h-3" />
                        {stats.thumbs_up}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <ThumbsDownIcon className="w-3 h-3" />
                        {stats.thumbs_down}
                      </span>
                    </div>
                  }
                />
              </div>
            )}

            {/* ── 3D Embedding visualization ── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Espacio de embeddings 3D
                </CardTitle>
                <CardDescription>
                  Proyección UMAP de los fragmentos indexados
                  {chunkCount > 0 && (
                    <span className="ml-1">
                      · <strong>{chunkCount}</strong> fragmentos
                    </span>
                  )}
                  {queryCount > 0 && (
                    <span className="ml-1">
                      · <strong>{queryCount}</strong> consultas
                    </span>
                  )}
                  . Puntos{" "}
                  <span className="text-[oklch(0.62_0.16_262)] dark:text-[oklch(0.62_0.16_262)]">
                    azules
                  </span>{" "}
                  = fragmentos ·{" "}
                  <span className="text-[oklch(0.74_0.17_75)]">dorados</span> =
                  consultas.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 h-96 overflow-hidden rounded-b-xl">
                {points.length > 0 ? (
                  <EmbeddingScene points={points} />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <div className="w-14 h-14 bg-muted rounded-2xl flex items-center justify-center">
                      <BarChart2Icon className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Sin datos de embeddings aún. Procesa documentos primero.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  icon,
  colorClass,
  sub,
}: {
  title: string
  value: string
  icon: React.ReactNode
  colorClass: string
  sub?: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center [&_svg]:w-4 [&_svg]:h-4 ${colorClass}`}
        >
          {icon}
        </div>
        <p className="text-2xl font-bold mt-3 tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground uppercase tracking-wide mt-0.5">
          {title}
        </p>
        {sub}
      </CardContent>
    </Card>
  )
}
