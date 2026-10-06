// Punto de entrada de las funciones de Vercel (carpeta api/): API con Vercel Blob privado.
// Variables de entorno: BLOB_READ_WRITE_TOKEN (al conectar el almacén Blob) y RESULTS_ACCESS_KEY.
import { handleApi } from './api.js'
import { createBlobStorage } from './storage.js'

let storagePromise

export async function handle(request) {
  storagePromise ||= createBlobStorage()
  return handleApi(request, { storage: await storagePromise, accessKey: process.env.RESULTS_ACCESS_KEY })
}
