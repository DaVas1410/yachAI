import { useEffect, useRef } from "react"
import * as THREE from "three"

interface Point {
  x: number
  y: number
  z: number
  is_query?: boolean
}

interface Props {
  points: Point[]
}

export default function EmbeddingScene({ points }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = mountRef.current
    if (!el) return

    const W = el.clientWidth
    const H = el.clientHeight

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(window.devicePixelRatio)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    /* Dark navy background matching the Yachay dark-mode palette */
    scene.background = new THREE.Color(0x0a0e1a)

    const camera = new THREE.PerspectiveCamera(55, W / H, 0.01, 100)
    camera.position.set(0, 0, 5)

    /* Subtle fog for depth */
    scene.fog = new THREE.FogExp2(0x0a0e1a, 0.06)

    const chunkPts = points.filter((p) => !p.is_query)
    const queryPts = points.filter((p) => p.is_query)

    function makeSprites(pts: Point[], color: number, size: number) {
      if (pts.length === 0) return
      const geo = new THREE.BufferGeometry()
      const pos = new Float32Array(pts.length * 3)
      pts.forEach((p, i) => {
        pos[i * 3] = p.x
        pos[i * 3 + 1] = p.y
        pos[i * 3 + 2] = p.z
      })
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
      const mat = new THREE.PointsMaterial({
        color,
        size,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
      })
      scene.add(new THREE.Points(geo, mat))
    }

    /* Yachay blue  (~oklch 0.62 0.16 262 → #1D56A0-ish lighter for dark bg) */
    makeSprites(chunkPts, 0x3b82f6, 0.05)
    /* Yachay gold  (~oklch 0.74 0.17 75  → #F59E0B) */
    makeSprites(queryPts, 0xf59e0b, 0.12)

    let animId: number
    let angle = 0

    function animate() {
      animId = requestAnimationFrame(animate)
      angle += 0.0025
      camera.position.x = Math.sin(angle) * 5
      camera.position.z = Math.cos(angle) * 5
      camera.lookAt(0, 0, 0)
      renderer.render(scene, camera)
    }
    animate()

    const handleResize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    const ro = new ResizeObserver(handleResize)
    ro.observe(el)

    return () => {
      cancelAnimationFrame(animId)
      ro.disconnect()
      renderer.dispose()
      if (el.contains(renderer.domElement)) {
        el.removeChild(renderer.domElement)
      }
    }
  }, [points])

  return <div ref={mountRef} className="w-full h-full" />
}
