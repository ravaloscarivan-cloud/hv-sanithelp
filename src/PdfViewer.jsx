import { useEffect, useRef, useState } from 'react'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Visor propio con PDF.js: el visor nativo del navegador abre los enlaces del PDF
// dentro del mismo iframe, aquí cada enlace externo abre una pestaña nueva.
async function createLoadingTask(url) {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjs.getDocument({ url })
}

function PdfPage({ pdf, pageNumber, ratio, resolveLink }) {
  const wrapperRef = useRef(null)
  const canvasRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [links, setLinks] = useState([])
  const [pageRatio, setPageRatio] = useState(ratio)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setVisible(true),
      { rootMargin: '600px 0px' },
    )
    observer.observe(wrapperRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    let cancelled = false
    let renderTask = null

    pdf.getPage(pageNumber).then(async (page) => {
      if (cancelled) return
      const [x0, y0, x1, y1] = page.view
      const pageWidth = x1 - x0
      const pageHeight = y1 - y0
      setPageRatio(pageHeight / pageWidth)

      const annotations = await page.getAnnotations()
      if (cancelled) return
      setLinks(annotations
        .filter((annotation) => annotation.subtype === 'Link' && annotation.url)
        .map((annotation) => {
          const [ax0, ay0, ax1, ay1] = annotation.rect
          return {
            id: annotation.id,
            url: annotation.url,
            style: {
              left: `${((Math.min(ax0, ax1) - x0) / pageWidth) * 100}%`,
              top: `${((y1 - Math.max(ay0, ay1)) / pageHeight) * 100}%`,
              width: `${(Math.abs(ax1 - ax0) / pageWidth) * 100}%`,
              height: `${(Math.abs(ay1 - ay0) / pageHeight) * 100}%`,
            },
          }
        }))

      const canvas = canvasRef.current
      const cssWidth = wrapperRef.current.clientWidth
      const scale = (cssWidth / pageWidth) * Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale })
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport })
      await renderTask.promise.catch(() => {})
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [visible, pdf, pageNumber])

  return (
    <div
      ref={wrapperRef}
      className="pdf-page"
      style={{ aspectRatio: `1 / ${pageRatio}` }}
      aria-label={`Página ${pageNumber}`}
    >
      <canvas ref={canvasRef} />
      {links.map((link) => (
        <a
          key={link.id}
          className="pdf-page-link"
          href={resolveLink(link.url)}
          target="_blank"
          rel="noreferrer"
          style={link.style}
          title={resolveLink(link.url)}
          aria-label={`Abrir enlace en una pestaña nueva: ${resolveLink(link.url)}`}
        />
      ))}
    </div>
  )
}

export default function PdfViewer({ url, title, className = '', resolveLink = (link) => link }) {
  const [pdf, setPdf] = useState(null)
  const [ratio, setRatio] = useState(9 / 16)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let loadingTask = null
    createLoadingTask(url)
      .then((task) => {
        loadingTask = task
        if (cancelled) task.destroy()
        return task.promise
      })
      .then(async (doc) => {
        const firstPage = await doc.getPage(1)
        const [x0, y0, x1, y1] = firstPage.view
        if (cancelled) return
        setRatio((y1 - y0) / (x1 - x0))
        setPdf(doc)
      })
      .catch((loadError) => {
        if (cancelled) return
        console.error('No se pudo cargar el PDF de inducción.', loadError)
        setError('No se pudo cargar el PDF.')
      })

    return () => {
      cancelled = true
      loadingTask?.destroy()
    }
  }, [url])

  return (
    <div className={`pdf-reader ${className}`} role="document" aria-label={title}>
      {error && <p className="pdf-reader-status">{error}</p>}
      {!pdf && !error && <p className="pdf-reader-status">Cargando PDF...</p>}
      {pdf && Array.from({ length: pdf.numPages }, (_, index) => (
        <PdfPage key={index + 1} pdf={pdf} pageNumber={index + 1} ratio={ratio} resolveLink={resolveLink} />
      ))}
    </div>
  )
}
