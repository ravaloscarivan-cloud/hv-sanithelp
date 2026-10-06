// Comunicación con la API de resultados (server/api.js).
// Ver, descargar o borrar resultados exige la clave de Resultados, que se valida en el servidor.
export class AccessDeniedError extends Error {
  constructor() {
    super('Clave incorrecta. Intenta de nuevo.')
  }
}

let configPromise
function getApiConfig() {
  configPromise ||= fetch('/api/config')
    .then((response) => (response.ok ? response.json() : { pdfUpload: 'inline' }))
    .catch(() => ({ pdfUpload: 'inline' }))
  return configPromise
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

async function ensureOk(response, message) {
  if (response.status === 401) throw new AccessDeniedError()
  if (!response.ok) throw new Error(message)
  return response
}

// Registra el resultado al terminar. En producción el PDF se sube directo a Vercel Blob (privado)
// desde el navegador, porque las funciones de Vercel no aceptan cuerpos de más de 4,5 MB.
export async function savePerson({ pdfBlob, ...person }) {
  const { pdfUpload } = await getApiConfig()
  let pdfBase64
  if (pdfUpload === 'blob') {
    const { upload } = await import('@vercel/blob/client')
    await upload(`pdfs/${person.id}.pdf`, pdfBlob, {
      access: 'private',
      contentType: 'application/pdf',
      handleUploadUrl: '/api/upload',
      multipart: pdfBlob.size > 8 * 1024 * 1024,
    })
  } else {
    pdfBase64 = await blobToBase64(pdfBlob)
  }

  const response = await fetch('/api/people', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ person, pdfBase64 }),
  })
  await ensureOk(response, 'No se pudo guardar el resultado.')
  return response.json()
}

export async function getPeopleDatabase(accessKey) {
  const response = await fetch('/api/people', { headers: { 'x-access-key': accessKey } })
  await ensureOk(response, 'No se pudieron cargar los resultados guardados.')
  return response.json()
}

export async function getPersonPdf(person, accessKey) {
  const response = await fetch(person.pdfUrl, { headers: { 'x-access-key': accessKey } })
  await ensureOk(response, 'No se pudo cargar el PDF guardado.')
  return response.blob()
}

export async function deletePerson(personId, accessKey) {
  const response = await fetch(`/api/people/${encodeURIComponent(personId)}`, {
    method: 'DELETE',
    headers: { 'x-access-key': accessKey },
  })
  await ensureOk(response, 'No se pudo eliminar el resultado guardado.')
}
