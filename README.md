# HV SanitHelp

Portal de ingreso y actualización de hojas de vida (Gestión Humana - SST). Publicado en
<https://hv-sanithelp.vercel.app>.

La persona avanza por cuatro secciones:

1. **Formato HV**: llena la hoja de vida y la guarda como PDF.
2. **HV y soportes**: adjunta los soportes en PDF o los marca como "No aplica".
3. **Inducción**: lee la presentación y firma la constancia de inducción (se abre en otra pestaña).
4. **Inducción general**: pre-test y pos-test de cada política SST y constancia de evaluaciones.

Desde que guarda la sección 1, su PDF de respuesta se crea en **Resultados** y se actualiza con cada
sección que completa ("En progreso · n / 4"). Al pulsar **Terminar** queda la versión final ("Completo").
El avance también se guarda en el navegador (IndexedDB), así que puede cerrar y continuar después en
el mismo equipo.

## Requisitos

- [Node.js](https://nodejs.org) 20 o superior.
- Google Chrome (solo para la prueba de punta a punta).

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # opcional: define RESULTS_ACCESS_KEY
npm run dev
```

Abre <http://localhost:3000>. En local, la API guarda los resultados en `data/` (no se sube al
repositorio) y la clave de Resultados es `clave-local`, salvo que definas `RESULTS_ACCESS_KEY` en
`.env.local`.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con la API local (puerto 3000). |
| `npm run build` | Compila la app en `dist/`. |
| `npm run preview` | Sirve la compilación (sin API). |
| `npm run test:e2e` | Prueba de punta a punta con Chrome. Requiere `npm run dev` corriendo. |
| `npm run build:diapositivas` | Genera las presentaciones de `presentaciones/`. |

## Estructura

```
src/                 App en React (Vite)
  App.jsx            Secciones, guardado del avance y PDF de respuesta
  InductionForm.jsx  Constancia de inducción (/?constancia=1)
  Evaluacion.jsx     Pre-test y pos-test
  ConstanciaEvaluaciones.jsx
  progressStore.js   Avance en el navegador (IndexedDB)
  constanciaStore.js Constancia de inducción compartida entre pestañas
  peopleStore.js     Cliente de la API de resultados
  evaluaciones.js    Preguntas de los test
server/              API de resultados (la usan Vercel y el servidor de desarrollo)
api/                 Funciones de Vercel que llaman a server/
public/              PDF de inducción y políticas
PL/                  Políticas originales en Word
presentaciones/      Generador de las presentaciones
tests/               Prueba de punta a punta
```

## Producción (Vercel)

El proyecto se despliega en Vercel. Variables de entorno necesarias en el proyecto de Vercel:

- `RESULTS_ACCESS_KEY`: clave para abrir Resultados.
- `BLOB_READ_WRITE_TOKEN`: se crea sola al conectar un almacén **Vercel Blob** al proyecto. Los PDF y
  las bases `personas.json` y `respuestas.json` se guardan ahí, en privado.

Para desplegar a mano: `npx vercel --prod`. Si se conecta este repositorio al proyecto de Vercel,
cada push a `main` se despliega solo.

## Datos personales

Nunca subas al repositorio `data/`, `.env.local` ni PDF con datos reales: ya están en `.gitignore`.
