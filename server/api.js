// API de resultados con Request/Response estándar: la usan las funciones de Vercel (api/) y el
// servidor de desarrollo de Vite (vite.config.js), cada uno con su almacenamiento.
//
//   GET    /api/config             cómo subir el PDF: 'blob' (producción) o 'inline' (desarrollo)
//   POST   /api/upload             token para que el navegador suba el PDF directo a Vercel Blob
//   POST   /api/people             crea o actualiza el resultado de una persona a medida que avanza
//                                   en el proceso, y al terminar (no requiere clave)
//   GET    /api/people             lista de resultados                       (requiere clave)
//   GET    /api/people/:id/pdf     PDF de respuesta                          (requiere clave)
//   DELETE /api/people/:id         borra el resultado, su PDF y su respuesta (requiere clave)
//
// La clave de Resultados va en el encabezado x-access-key y se compara en el servidor.
import { createHash, timingSafeEqual } from 'node:crypto'
import { EMPTY_RESPUESTAS, removeRespuesta, toRespuestaData, upsertRespuesta } from './respuestasDb.js'

const PEOPLE = 'personas.json'
const RESPUESTAS = 'respuestas.json'
const ID_PATTERN = /^[\w-]{1,64}$/
const MAX_PDF_BYTES = 200 * 1024 * 1024

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })

function sameKey(given, expected) {
  // Se comparan los hash para no filtrar la longitud ni el contenido por tiempos de respuesta.
  const digest = (value) => createHash('sha256').update(String(value)).digest()
  return timingSafeEqual(digest(given), digest(expected))
}

function requireKey(request, accessKey) {
  if (!accessKey) return json({ error: 'Falta configurar RESULTS_ACCESS_KEY en el servidor.' }, 500)
  const given = request.headers.get('x-access-key') || ''
  return given && sameKey(given, accessKey) ? null : json({ error: 'Clave incorrecta.' }, 401)
}

const STEPS = ['hv', 'soportes', 'induccion', 'evaluaciones']

// Secciones que la persona ya completó. Sin pasos (versiones anteriores) el proceso se da por completo.
function cleanSteps(pasos, completo) {
  return Object.fromEntries(STEPS.map((step) => [step, completo || pasos?.[step] === true]))
}

function isValidPerson(person) {
  return typeof person?.id === 'string' && ID_PATTERN.test(person.id)
    && typeof person.name === 'string' && person.name.trim()
    && typeof person.email === 'string' && person.email.trim()
    && typeof person.createdAt === 'string' && !Number.isNaN(Date.parse(person.createdAt))
}

async function savePersonResult(request, storage) {
  const { person, pdfBase64 } = await request.json()
  if (!isValidPerson(person)) return json({ error: 'Faltan datos de la persona.' }, 400)

  if (typeof pdfBase64 === 'string' && pdfBase64) {
    const bytes = Buffer.from(pdfBase64, 'base64')
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return json({ error: 'PDF no válido.' }, 400)
    await storage.savePdf(person.id, bytes)
  } else if (!(await storage.hasPdf(person.id))) {
    // En producción el navegador sube el PDF antes de llamar aquí.
    return json({ error: 'No se encontró el PDF de respuesta.' }, 400)
  }

  const completo = person.completo !== false
  const updatedAt = new Date().toISOString()
  const storedPerson = await storage.update(PEOPLE, [], (people) => {
    const existing = people.find((entry) => entry.id === person.id)
    const entry = {
      id: person.id,
      name: person.name.trim().slice(0, 200),
      email: person.email.trim().slice(0, 200),
      // La fecha de creación es la del primer guardado (sección 1); cada avance solo cambia updatedAt.
      createdAt: existing?.createdAt || person.createdAt,
      updatedAt,
      completo,
      pasos: cleanSteps(person.pasos, completo),
      pdfUrl: `/api/people/${encodeURIComponent(person.id)}/pdf`,
    }
    return {
      data: [entry, ...people.filter((other) => other.id !== person.id)]
        .sort((first, second) => second.createdAt.localeCompare(first.createdAt)),
      result: entry,
    }
  })
  // Nombre, apellido, teléfono, correo, empresa y evaluaciones solo se guardan en respuestas.json.
  await storage.update(RESPUESTAS, EMPTY_RESPUESTAS, (respuestas) => upsertRespuesta(respuestas, toRespuestaData({ ...person, completo, pasos: storedPerson.pasos, updatedAt })))
  return json(storedPerson, 201)
}

async function deletePersonResult(storage, id) {
  let deleted = false
  await storage.update(PEOPLE, [], (people) => {
    const remaining = people.filter((person) => person.id !== id)
    deleted = remaining.length !== people.length
    return { data: remaining }
  })
  await storage.update(RESPUESTAS, EMPTY_RESPUESTAS, (respuestas) => removeRespuesta(respuestas, id))
  await storage.deletePdf(id)
  return json({ deleted })
}

async function handleUploadToken(request) {
  const { handleUpload } = await import('@vercel/blob/client')
  const result = await handleUpload({
    request,
    body: await request.json(),
    onBeforeGenerateToken: async (pathname) => {
      // Solo se permite subir el PDF de respuesta a pdfs/<id>.pdf.
      const match = pathname.match(/^pdfs\/([\w-]{1,64})\.pdf$/)
      if (!match) throw new Error('Ruta de archivo no permitida.')
      return {
        allowedContentTypes: ['application/pdf'],
        maximumSizeInBytes: MAX_PDF_BYTES,
        addRandomSuffix: false,
        allowOverwrite: true,
      }
    },
  })
  return json(result)
}

export async function handleApi(request, { storage, accessKey }) {
  const { pathname } = new URL(request.url)
  const method = request.method
  try {
    if (pathname === '/api/config' && method === 'GET') {
      return json({ pdfUpload: storage.kind === 'blob' ? 'blob' : 'inline' })
    }

    if (pathname === '/api/upload' && method === 'POST') {
      if (storage.kind !== 'blob') return json({ error: 'No disponible en este entorno.' }, 404)
      return await handleUploadToken(request)
    }

    if (pathname === '/api/people') {
      if (method === 'POST') return await savePersonResult(request, storage)
      if (method === 'GET') {
        return requireKey(request, accessKey) || json(await storage.readJson(PEOPLE, []))
      }
      return json({ error: 'Método no permitido.' }, 405)
    }

    const pdfRoute = pathname.match(/^\/api\/people\/([\w-]{1,64})\/pdf$/)
    if (pdfRoute && method === 'GET') {
      const denied = requireKey(request, accessKey)
      if (denied) return denied
      const pdf = await storage.readPdf(pdfRoute[1])
      if (!pdf) return json({ error: 'PDF no encontrado.' }, 404)
      return new Response(pdf.body, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(pdf.size),
          'Cache-Control': 'no-store',
        },
      })
    }

    const personRoute = pathname.match(/^\/api\/people\/([\w-]{1,64})$/)
    if (personRoute && method === 'DELETE') {
      return requireKey(request, accessKey) || await deletePersonResult(storage, personRoute[1])
    }

    return json({ error: 'Ruta no encontrada.' }, 404)
  } catch (error) {
    console.error(`[api] ${method} ${pathname}`, error)
    return json({ error: error instanceof SyntaxError ? 'Solicitud no válida.' : 'Error del servidor.' }, error instanceof SyntaxError ? 400 : 500)
  }
}
