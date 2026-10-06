// Almacenamiento de resultados con la misma interfaz en desarrollo y en producción:
// - createFsStorage: archivos en data/ (npm run dev).
// - createBlobStorage: Vercel Blob privado (producción). Nada queda con URL pública.
// Interfaz: readJson, update (lectura-modificación-escritura sin pisar cambios), savePdf, hasPdf,
// readPdf, deletePdf.
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export function createFsStorage(dataDir) {
  // Las escrituras se encadenan para que dos guardados seguidos no se pisen.
  let queue = Promise.resolve()
  const jsonPath = (name) => resolve(dataDir, name)
  const pdfPath = (id) => resolve(dataDir, 'pdfs', `${id}.pdf`)

  async function readJson(name, fallback) {
    try {
      return JSON.parse(await readFile(jsonPath(name), 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return fallback
      throw error
    }
  }

  return {
    kind: 'fs',
    readJson,

    update(name, fallback, change) {
      const task = queue.then(async () => {
        const { data, result } = change(await readJson(name, fallback))
        const path = jsonPath(name)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(`${path}.tmp`, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
        await rename(`${path}.tmp`, path)
        return result
      })
      queue = task.catch(() => {})
      return task
    },

    async savePdf(id, bytes) {
      await mkdir(resolve(dataDir, 'pdfs'), { recursive: true })
      await writeFile(pdfPath(id), bytes)
    },

    async hasPdf(id) {
      return access(pdfPath(id)).then(() => true, () => false)
    },

    async readPdf(id) {
      try {
        const bytes = await readFile(pdfPath(id))
        return { body: bytes, size: bytes.length }
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    },

    async deletePdf(id) {
      await unlink(pdfPath(id)).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
    },
  }
}

export async function createBlobStorage() {
  const { BlobNotFoundError, BlobPreconditionFailedError, del, get, head, put } = await import('@vercel/blob')
  const jsonPath = (name) => `db/${name}`
  const pdfPath = (id) => `pdfs/${id}.pdf`

  async function readJsonWithEtag(name, fallback) {
    // La ETag se toma de head(): get() la devuelve "débil" (W/...) porque comprime el JSON, y la
    // escritura condicional exige la exacta. Se lee antes que el contenido: si alguien guarda entre
    // las dos lecturas, la ETag queda vieja y la escritura se rechaza y se reintenta.
    let etag
    try {
      etag = (await head(jsonPath(name))).etag
    } catch (error) {
      if (error instanceof BlobNotFoundError) return { data: fallback, etag: null }
      throw error
    }
    // Sin caché: siempre la versión más reciente, para no perder escrituras.
    const result = await get(jsonPath(name), { access: 'private', useCache: false })
    if (!result?.stream) return { data: fallback, etag: null }
    return { data: JSON.parse(await new Response(result.stream).text()), etag }
  }

  return {
    kind: 'blob',

    async readJson(name, fallback) {
      return (await readJsonWithEtag(name, fallback)).data
    },

    // Escritura condicional (ETag): si otra persona guardó al mismo tiempo, se vuelve a leer y se
    // reintenta, así nunca se repite un número de participante ni se pierde un registro.
    async update(name, fallback, change) {
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const { data, etag } = await readJsonWithEtag(name, fallback)
        const { data: next, result } = change(data)
        try {
          await put(jsonPath(name), JSON.stringify(next, null, 2), {
            access: 'private',
            contentType: 'application/json',
            addRandomSuffix: false,
            allowOverwrite: Boolean(etag),
            ...(etag ? { ifMatch: etag } : {}),
          })
          return result
        } catch (error) {
          // Conflicto: otro guardado ganó (ETag distinto, dos escrituras al mismo tiempo o el archivo
          // se creó mientras tanto). Se vuelve a leer y se reintenta.
          const conflict = error instanceof BlobPreconditionFailedError || /conflict|exist/i.test(error.message)
          if (!conflict) throw error
          await new Promise((wait) => setTimeout(wait, 150 * (attempt + 1) * Math.random() + 50))
        }
      }
      throw new Error(`No se pudo actualizar ${name}: demasiados guardados simultáneos.`)
    },

    async savePdf(id, bytes) {
      await put(pdfPath(id), bytes, {
        access: 'private',
        contentType: 'application/pdf',
        addRandomSuffix: false,
        allowOverwrite: true,
      })
    },

    async hasPdf(id) {
      try {
        await head(pdfPath(id))
        return true
      } catch (error) {
        if (error instanceof BlobNotFoundError) return false
        throw error
      }
    },

    async readPdf(id) {
      // Sin caché: el PDF se reescribe a medida que la persona avanza y debe verse la última versión.
      const result = await get(pdfPath(id), { access: 'private', useCache: false })
      if (!result?.stream) return null
      return { body: result.stream, size: result.blob.size }
    },

    async deletePdf(id) {
      await del(pdfPath(id))
    },
  }
}
