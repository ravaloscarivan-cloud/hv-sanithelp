import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Archive, BookOpen, Check, CheckCircle2, ClipboardCheck, Download, ExternalLink, Eye, FileSignature, FileText, KeyRound, Lock, Save, ScrollText, Send, ShieldCheck, Trash2, TriangleAlert, Upload, X } from 'lucide-react'
import logoSanitHelp from './assets/logo_sanithelp.png'
import { AccessDeniedError, deletePerson, getPeopleDatabase, getPersonPdf, savePerson } from './peopleStore'
import PdfViewer from './PdfViewer'
import Evaluacion from './Evaluacion'
import ConstanciaEvaluaciones from './ConstanciaEvaluaciones'
import { clearConstancia, getConstanciaPageUrl, readConstancia, subscribeConstancia } from './constanciaStore'
import { deleteDraft, getSessionId, readDraft, startNewSession, writeDraft } from './progressStore'

const SUPPORT_DOCUMENTS = [
  { id: 'completed-cv', label: 'Subir hoja de vida personal' },
  {
    id: 'profile',
    label: 'Perfil e información general de hoja de vida',
    detail: 'Diplomas, actas y certificados',
  },
  { id: 'contract', label: 'Copia del contrato' },
  {
    id: 'studies',
    label: 'Soportes de estudio',
    detail: 'Diploma de bachiller, técnico, tecnólogo, universitario y certificados de cursos',
  },
  { id: 'updates', label: 'Novedades que se presenten' },
  { id: 'identity', label: 'Fotocopia ampliada de la cédula de ciudadanía' },
  { id: 'professional-card', label: 'Tarjeta profesional y/o resolución', detail: 'Según sea el caso' },
  { id: 'background', label: 'Consulta de antecedentes de la Policía Nacional' },
  { id: 'medical-entry', label: 'Certificado de examen médico de ingreso y psicotécnicos' },
  {
    id: 'medical-periodic',
    label: 'Certificado de examen médico periódico',
    detail: 'Según el tiempo laborado',
  },
  { id: 'affiliations', label: 'Afiliaciones a salud, pensión y ARL' },
]
// Políticas de la carpeta PL convertidas a PDF (public/induccion-general).
const GENERAL_INDUCTION_DOCUMENTS = [
  { id: 'pl-gh-001', code: 'PL-GH-001', title: 'Política de desconexión laboral', file: 'PL-GH-001-politica-desconexion-laboral.pdf' },
  { id: 'pl-gh-002', code: 'PL-GH-002', title: 'Política de alcohol y no drogas', file: 'PL-GH-002-politica-alcohol-y-no-drogas.pdf' },
  { id: 'pl-gh-003', code: 'PL-GH-003', title: 'Política de orden y aseo', file: 'PL-GH-003-politica-orden-y-aseo.pdf' },
  { id: 'pl-gh-005', code: 'PL-GH-005', title: 'Política de acoso laboral', file: 'PL-GH-005-politica-acoso-laboral.pdf' },
  { id: 'pl-gh-006', code: 'PL-GH-006', title: 'Política de seguridad y salud en el trabajo', file: 'PL-GH-006-politica-seguridad-y-salud-en-el-trabajo.pdf' },
  { id: 'r-sst-01', code: 'R-SST-01', title: 'Política de seguridad y salud en el trabajo', file: 'politica-seguridad-y-salud-en-el-trabajo.pdf' },
]
const INDUCTION_FORM_URL = 'https://calk6ra1.forms.app/untitled-form'
const MENU_ITEMS = [
  { id: 'form', label: 'Formato HV', hint: 'Sección 1', icon: FileText },
  { id: 'supports', label: 'HV y soportes', hint: 'Sección 2', icon: Upload },
  { id: 'induction', label: 'Inducción', hint: 'Sección 3', icon: BookOpen },
  { id: 'general-induction', label: 'Inducción general', hint: 'Sección 4', icon: ScrollText },
  { id: 'results', label: 'Resultados', hint: 'PDF guardados', icon: Archive },
]

function getInitials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('') || 'HV'
}

function FormField({ label, type = 'text', required = false }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input type={type} defaultValue="" required={required} />
    </label>
  )
}

function getFieldValue(form, label) {
  const field = [...form.querySelectorAll('.form-field')]
    .find((item) => item.querySelector('span')?.textContent.trim() === label)
  return field?.querySelector('input')?.value.trim() || ''
}

function getCvInputs(form) {
  return [...form.querySelectorAll('input:not([type="file"])')]
}

// Datos de la HV que se precargan en la constancia de inducción.
function getCvSummary(form) {
  return {
    firstName: getFieldValue(form, 'Nombres'),
    lastName: getFieldValue(form, 'Apellidos'),
    idNumber: getFieldValue(form, 'Documento de identidad'),
    role: getFieldValue(form, 'Cargo'),
    email: getFieldValue(form, 'Correo personal'),
  }
}

const EMPTY_CV_FORM = { values: [], summary: {} }

// Formulario que va debajo de la última política, bloqueado hasta completar todos los test.
const EVALUATION_CONSTANCIA_ID = 'constancia-evaluaciones'
// Si cambia el formato de los test, subir este número: el avance de evaluaciones guardado
// con otra versión se descarta y las políticas vuelven a quedar pendientes.
const EVALUATIONS_VERSION = 3

const completionLabel = (result) => (result ? 'Completado' : 'Pendiente')

// Resumen por política para la base de respuestas (data/respuestas.json). Los test no llevan puntaje.
function summarizeEvaluations(evaluations) {
  return GENERAL_INDUCTION_DOCUMENTS.map((document) => {
    const evaluation = evaluations[document.id] || {}
    return {
      codigo: document.code,
      politica: document.title,
      pre: completionLabel(evaluation.pre),
      pos: completionLabel(evaluation.pos),
    }
  })
}

// Página del PDF de respuesta con la constancia de que la persona presentó todos los test.
async function addEvaluationConstanciaPage(pdf, StandardFonts, constancia, rows) {
  const { rgb } = await import('pdf-lib')
  const page = pdf.addPage([595.28, 841.89])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const navy = rgb(0.09, 0.2, 0.36)
  const teal = rgb(0.17, 0.5, 0.59)
  const muted = rgb(0.33, 0.4, 0.48)
  const line = rgb(0.84, 0.9, 0.92)
  const green = rgb(0.12, 0.54, 0.36)
  const left = 50
  const right = 545
  let y = 780

  // Ajusta un texto al ancho disponible, partiéndolo en varias líneas.
  const wrap = (text, size, maxWidth, textFont = font) => {
    const lines = []
    let current = ''
    for (const word of text.split(' ')) {
      const candidate = current ? `${current} ${word}` : word
      if (textFont.widthOfTextAtSize(candidate, size) > maxWidth && current) {
        lines.push(current)
        current = word
      } else {
        current = candidate
      }
    }
    if (current) lines.push(current)
    return lines
  }

  page.drawRectangle({ x: 0, y: 0, width: 8, height: 841.89, color: teal })
  page.drawText('INDUCCIÓN GENERAL · POLÍTICAS SST', { x: left, y, size: 10, font: bold, color: teal })
  y -= 30
  page.drawText('Constancia de evaluaciones', { x: left, y, size: 24, font: bold, color: navy })
  y -= 22
  page.drawText('Pre-test y pos-test de las políticas de inducción general', { x: left, y, size: 11, font, color: muted })
  y -= 34

  // Helvetica estándar solo admite caracteres latinos: se quitan los demás (p. ej., emojis).
  const safe = (text = '') => text.replace(/[^\u0020-\u00ff\u2013\u2014\u2026]/g, '').trim()
  const fields = [['Nombres y apellidos', safe(constancia.nombre)], ['Cédula', safe(constancia.cedula)], ['Cargo', safe(constancia.cargo)]]
  const columnWidth = (right - left) / 3
  fields.forEach(([label, value], index) => {
    const x = left + index * columnWidth
    page.drawText(label.toUpperCase(), { x, y, size: 8, font: bold, color: muted })
    const lines = wrap(value || '—', 11, columnWidth - 12, bold)
    lines.slice(0, 2).forEach((text, lineIndex) => page.drawText(text, { x, y: y - 16 - lineIndex * 14, size: 11, font: bold, color: navy }))
  })
  y -= 58

  page.drawText('POLÍTICAS EVALUADAS', { x: left, y, size: 8, font: bold, color: muted })
  y -= 10
  page.drawRectangle({ x: left - 5, y: y - 22, width: right - left + 10, height: 22, color: navy })
  const headers = [['Código', left], ['Política', left + 72], ['Pre-test', left + 330], ['Pos-test', left + 410]]
  headers.forEach(([title, x]) => page.drawText(title, { x, y: y - 15, size: 9, font: bold, color: rgb(1, 1, 1) }))
  y -= 22
  for (const row of rows) {
    y -= 22
    page.drawText(row.codigo, { x: left, y: y + 7, size: 9, font: bold, color: navy })
    page.drawText(row.politica, { x: left + 72, y: y + 7, size: 9, font, color: navy })
    page.drawText(row.pre, { x: left + 330, y: y + 7, size: 9, font: bold, color: row.pre === 'Completado' ? green : muted })
    page.drawText(row.pos, { x: left + 410, y: y + 7, size: 9, font: bold, color: row.pos === 'Completado' ? green : muted })
    page.drawLine({ start: { x: left - 5, y }, end: { x: right + 5, y }, thickness: 0.8, color: line })
  }
  y -= 34

  const declaration = 'Declaro que leí las políticas de inducción general de SANITHELP IPS SAS y que presenté el pre-test y el pos-test de cada una de ellas.'
  const declarationLines = wrap(declaration, 10.5, right - left - 40)
  const boxHeight = declarationLines.length * 15 + 20
  page.drawRectangle({ x: left - 5, y: y - boxHeight + 12, width: right - left + 10, height: boxHeight, borderColor: line, borderWidth: 1, color: rgb(0.95, 0.98, 0.99) })
  page.drawRectangle({ x: left + 6, y: y - 3, width: 10, height: 10, borderColor: teal, borderWidth: 1.2, color: teal })
  page.drawText('X', { x: left + 8.2, y: y - 1.2, size: 8, font: bold, color: rgb(1, 1, 1) })
  declarationLines.forEach((text, index) => page.drawText(text, { x: left + 26, y: y - index * 15, size: 10.5, font, color: navy }))
  y -= boxHeight + 22

  page.drawText('FIRMA', { x: left, y, size: 8, font: bold, color: muted })
  y -= 10
  const signatureHeight = 96
  page.drawRectangle({ x: left - 5, y: y - signatureHeight, width: 330, height: signatureHeight, borderColor: line, borderWidth: 1 })
  if (constancia.firma) {
    const signature = await pdf.embedPng(constancia.firma)
    const scale = Math.min(320 / signature.width, (signatureHeight - 8) / signature.height)
    page.drawImage(signature, {
      x: left,
      y: y - signatureHeight + 4,
      width: signature.width * scale,
      height: signature.height * scale,
    })
  }
  y -= signatureHeight + 18
  const sentAt = new Date(constancia.at).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' })
  page.drawText(`Enviada el ${sentAt}`, { x: left, y, size: 10, font, color: muted })
}

const RESULT_STEPS = [
  { id: 'hv', label: 'Formato HV' },
  { id: 'soportes', label: 'HV y soportes' },
  { id: 'induccion', label: 'Constancia de inducción' },
  { id: 'evaluaciones', label: 'Constancia de evaluaciones' },
]

function supportsResolved(supportFiles, notApplicable) {
  return SUPPORT_DOCUMENTS.every((document) => supportFiles[document.id] || notApplicable[document.id])
}

// Secciones completadas, tal como se guardan con el resultado.
function getResultSteps({ savedCvPdf, supportFiles, notApplicable, constancia, evaluationConstancia }) {
  return {
    hv: Boolean(savedCvPdf),
    soportes: supportsResolved(supportFiles, notApplicable),
    induccion: Boolean(constancia),
    evaluaciones: Boolean(evaluationConstancia),
  }
}

// Primera página del PDF mientras el proceso no ha terminado: qué secciones ya están y cuáles faltan.
async function addProgressPage(pdf, StandardFonts, steps, supportFiles, notApplicable) {
  const { rgb } = await import('pdf-lib')
  const page = pdf.addPage([595.28, 841.89])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const navy = rgb(0.09, 0.2, 0.36)
  const teal = rgb(0.17, 0.5, 0.59)
  const muted = rgb(0.33, 0.4, 0.48)
  const line = rgb(0.84, 0.9, 0.92)
  const green = rgb(0.12, 0.54, 0.36)
  const amber = rgb(0.72, 0.45, 0.05)
  const left = 50
  const right = 545
  let y = 780

  page.drawRectangle({ x: 0, y: 0, width: 8, height: 841.89, color: amber })
  page.drawText('PROCESO EN CURSO', { x: left, y, size: 10, font: bold, color: amber })
  y -= 30
  page.drawText('Avance de la hoja de vida', { x: left, y, size: 24, font: bold, color: navy })
  y -= 22
  const updatedAt = new Date().toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' })
  page.drawText(`Actualizado el ${updatedAt}. Este PDF se completa a medida que la persona avanza.`, { x: left, y, size: 10, font, color: muted })
  y -= 40

  const doneCount = RESULT_STEPS.filter((step) => steps[step.id]).length
  page.drawText(`SECCIONES COMPLETADAS: ${doneCount} DE ${RESULT_STEPS.length}`, { x: left, y, size: 8, font: bold, color: muted })
  y -= 12
  for (const step of RESULT_STEPS) {
    const done = steps[step.id]
    y -= 34
    page.drawRectangle({ x: left - 5, y: y - 9, width: right - left + 10, height: 30, borderColor: line, borderWidth: 1, color: done ? rgb(0.93, 0.98, 0.95) : rgb(1, 1, 1) })
    page.drawText(step.label, { x: left + 8, y: y + 2, size: 11, font: bold, color: navy })
    const label = done ? 'Completado' : 'Pendiente'
    page.drawText(label, { x: right - 8 - bold.widthOfTextAtSize(label, 10), y: y + 2, size: 10, font: bold, color: done ? green : amber })
  }
  y -= 40

  const attached = SUPPORT_DOCUMENTS.filter((document) => supportFiles[document.id]).length
  const skipped = SUPPORT_DOCUMENTS.filter((document) => !supportFiles[document.id] && notApplicable[document.id]).length
  const pending = SUPPORT_DOCUMENTS.length - attached - skipped
  page.drawText(`Soportes: ${attached} adjuntos, ${skipped} marcados como no aplica, ${pending} pendientes.`, { x: left, y, size: 10, font, color: teal })
}

// PDF de respuesta con lo que la persona lleva: constancia de inducción, HV, soportes y constancia
// de evaluaciones. Mientras no termina, va primero una página con el avance.
async function buildResultPdf(snapshot, completo) {
  const { savedCvPdf, supportFiles, notApplicable, constancia, evaluationConstancia, evaluations } = snapshot
  const { PDFDocument, StandardFonts } = await import('pdf-lib')
  const combinedPdf = await PDFDocument.create()
  const appendPdf = async (blob) => {
    const source = await PDFDocument.load(await blob.arrayBuffer())
    const pages = await combinedPdf.copyPages(source, source.getPageIndices())
    pages.forEach((page) => combinedPdf.addPage(page))
  }

  if (!completo) await addProgressPage(combinedPdf, StandardFonts, getResultSteps(snapshot), supportFiles, notApplicable)
  // La constancia de inducción va primero en el PDF de resultados.
  if (constancia) await appendPdf(constancia.blob)
  await appendPdf(savedCvPdf.blob)

  for (const document of SUPPORT_DOCUMENTS) {
    const file = supportFiles[document.id]
    if (file) await appendPdf(file)
  }

  const otherSupportAttached = SUPPORT_DOCUMENTS.some(
    (document) => document.id !== 'completed-cv' && supportFiles[document.id],
  )
  if (!otherSupportAttached && supportsResolved(supportFiles, notApplicable)) {
    const page = combinedPdf.addPage([595.28, 841.89])
    const font = await combinedPdf.embedFont(StandardFonts.Helvetica)
    const message = 'Soportes no aplica'
    const fontSize = 20
    const textWidth = font.widthOfTextAtSize(message, fontSize)
    page.drawText(message, {
      x: (page.getWidth() - textWidth) / 2,
      y: page.getHeight() / 2,
      size: fontSize,
      font,
    })
  }

  // La constancia de evaluaciones de Inducción general va al final, si la persona la envió.
  if (evaluationConstancia) {
    await addEvaluationConstanciaPage(combinedPdf, StandardFonts, evaluationConstancia, summarizeEvaluations(evaluations))
  }

  return new Blob([await combinedPdf.save()], { type: 'application/pdf' })
}

// Huella de lo que va en el resultado: si no cambió desde el último envío, no se vuelve a subir.
function getResultSignature({ savedCvPdf, supportFiles, notApplicable, constancia, evaluationConstancia, evaluations }) {
  const files = SUPPORT_DOCUMENTS.map((document) => {
    const file = supportFiles[document.id]
    return file ? `${file.name}:${file.size}:${file.lastModified}` : notApplicable[document.id] ? 'na' : ''
  })
  return JSON.stringify([
    savedCvPdf ? `${savedCvPdf.filename}:${savedCvPdf.blob.size}:${savedCvPdf.savedAt || ''}` : '',
    files,
    constancia?.createdAt || '',
    evaluationConstancia?.at || '',
    summarizeEvaluations(evaluations).map((row) => row.pre + row.pos),
  ])
}

function getCandidateName(form) {
  return [getFieldValue(form, 'Nombres'), getFieldValue(form, 'Apellidos')].filter(Boolean).join(' ')
}

function formatInputDate(value) {
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}

function makeFilename(candidateName, suffix) {
  const safeName = candidateName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  return `${safeName || 'hoja-de-vida'}-${suffix}.pdf`
}

async function generateFormPdf(form) {
  const { default: html2pdf } = await import('html2pdf.js')
  const candidateName = getCandidateName(form)
  const candidateEmail = getFieldValue(form, 'Correo personal')
  const printable = form.cloneNode(true)
  printable.classList.add('pdf-single-page')

  printable.querySelector('.form-actions')?.remove()
  printable.querySelector('.upload-photo-btn')?.remove()
  printable.querySelector('.remove-photo-btn')?.remove()
  printable.querySelectorAll('input').forEach((input) => {
    if (input.type === 'file') {
      input.remove()
      return
    }

    const value = document.createElement('span')
    value.className = 'pdf-input-value'
    value.textContent = (input.type === 'date' ? formatInputDate(input.value) : input.value) || ' '
    input.replaceWith(value)
  })

  printable.style.width = '730px'
  printable.style.maxWidth = 'none'
  printable.style.margin = '0'
  printable.style.border = '0'
  printable.style.borderRadius = '0'

  const blob = await html2pdf()
    .set({
      margin: [8, 8, 8, 8],
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: {
        scale: 1.5,
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: 1200,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
      pagebreak: { mode: [] },
    })
    .from(printable)
    .outputPdf('blob')

  const { PDFDocument } = await import('pdf-lib')
  const generatedPdf = await PDFDocument.load(await blob.arrayBuffer())
  if (generatedPdf.getPageCount() !== 1) {
    throw new Error('La hoja de vida debe generarse en una sola página.')
  }

  // Datos de contacto que van a la base de respuestas (data/respuestas.json).
  const contact = {
    nombre: getFieldValue(form, 'Nombres'),
    apellido: getFieldValue(form, 'Apellidos'),
    telefono: getFieldValue(form, 'Celular') || getFieldValue(form, 'Teléfono'),
    correo: candidateEmail,
    empresa: getFieldValue(form, 'Socio(a) a'),
  }

  return { blob, candidateName, candidateEmail, contact, filename: makeFilename(candidateName, 'HV') }
}

export default function App() {
  const [sessionId, setSessionId] = useState(() => getSessionId())
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [cvForm, setCvForm] = useState(EMPTY_CV_FORM)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoUrl, setPhotoUrl] = useState('')
  const [activeSection, setActiveSection] = useState('form')
  const [supportFiles, setSupportFiles] = useState({})
  const [notApplicable, setNotApplicable] = useState({})
  const [uploadErrors, setUploadErrors] = useState({})
  const [savedCvPdf, setSavedCvPdf] = useState(null)
  const [cvDirty, setCvDirty] = useState(true)
  const [savedResults, setSavedResults] = useState([])
  const [workflowMessage, setWorkflowMessage] = useState(null)
  const [processing, setProcessing] = useState('')
  const [viewingPdf, setViewingPdf] = useState(null)
  const [resultsKey, setResultsKey] = useState('')
  const [resultsLoading, setResultsLoading] = useState(false)
  const [resultsPassword, setResultsPassword] = useState('')
  const [resultsPasswordError, setResultsPasswordError] = useState('')
  const [constancia, setConstancia] = useState(() => readConstancia(sessionId))
  const [generalDocumentId, setGeneralDocumentId] = useState(GENERAL_INDUCTION_DOCUMENTS[0].id)
  const [evaluations, setEvaluations] = useState({})
  const [evaluationConstancia, setEvaluationConstancia] = useState(null)
  const [quizMode, setQuizMode] = useState('')
  const [quizFeedback, setQuizFeedback] = useState(null)
  const [quizProgress, setQuizProgress] = useState({})
  const [evaluationConstanciaDraft, setEvaluationConstanciaDraft] = useState(null)
  const [syncedSignature, setSyncedSignature] = useState('')
  const [syncStatus, setSyncStatus] = useState('')
  const cvFormRef = useRef(null)
  const draftLoadedRef = useRef(false)
  const generalMainRef = useRef(null)
  const cvValuesRef = useRef(cvForm.values)
  cvValuesRef.current = cvForm.values

  useEffect(() => {
    setConstancia(readConstancia(sessionId))
    return subscribeConstancia(sessionId, setConstancia)
  }, [sessionId])

  // Recupera el avance de este registro (HV, foto y soportes) al abrir la app.
  useEffect(() => {
    let mounted = true
    // Pide que el navegador no borre el avance guardado aunque le falte espacio.
    navigator.storage?.persist?.().catch(() => {})
    readDraft(sessionId)
      .then((draft) => {
        if (!mounted || !draft) return
        const hasProgress = Boolean(draft.savedCvPdf)
          || draft.cvForm?.values?.some(Boolean)
          || Object.keys(draft.supportFiles || {}).length > 0
          || Object.values(draft.notApplicable || {}).some(Boolean)
          || Object.keys(draft.evaluations || {}).length > 0
        if (hasProgress) {
          setWorkflowMessage({ type: 'success', text: 'Recuperamos tu avance guardado. Puedes continuar donde lo dejaste.' })
        }
        setCvForm(draft.cvForm || EMPTY_CV_FORM)
        setPhotoFile(draft.photoFile || null)
        setSavedCvPdf(draft.savedCvPdf || null)
        setCvDirty(draft.cvDirty ?? true)
        setSupportFiles(draft.supportFiles || {})
        setNotApplicable(draft.notApplicable || {})
        const sameVersion = draft.evaluationsVersion === EVALUATIONS_VERSION
        // Con otra versión se vacía explícitamente, también lo que pudiera quedar en memoria.
        setEvaluations(sameVersion ? draft.evaluations || {} : {})
        setEvaluationConstancia(sameVersion ? draft.evaluationConstancia || null : null)
        setQuizProgress(sameVersion ? draft.quizProgress || {} : {})
        setEvaluationConstanciaDraft(sameVersion ? draft.evaluationConstanciaDraft || null : null)
        setSyncedSignature(draft.syncedSignature || '')
        if (draft.syncedSignature) setSyncStatus('saved')
        // Vuelve a la sección en la que estaba la persona (Resultados no: pide clave cada vez).
        const ui = draft.ui || {}
        if (MENU_ITEMS.some((item) => item.id === ui.activeSection && item.id !== 'results')) setActiveSection(ui.activeSection)
        if (sameVersion && (ui.generalDocumentId === EVALUATION_CONSTANCIA_ID || GENERAL_INDUCTION_DOCUMENTS.some((document) => document.id === ui.generalDocumentId))) {
          setGeneralDocumentId(ui.generalDocumentId)
          if (ui.quizMode === 'pos') setQuizMode('pos')
        }
      })
      .catch((error) => console.error('No se pudo recuperar el avance guardado.', error))
      .finally(() => {
        if (!mounted) return
        draftLoadedRef.current = true
        setDraftLoaded(true)
      })

    return () => {
      mounted = false
    }
    // Solo al montar: al terminar se reinicia el estado a mano junto con el nuevo registro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentDraft = {
    cvForm,
    photoFile,
    savedCvPdf,
    cvDirty,
    supportFiles,
    notApplicable,
    evaluations,
    evaluationConstancia,
    quizProgress,
    evaluationConstanciaDraft,
    syncedSignature,
    evaluationsVersion: EVALUATIONS_VERSION,
    ui: { activeSection, generalDocumentId, quizMode },
  }
  const currentDraftRef = useRef(currentDraft)
  currentDraftRef.current = currentDraft
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  function saveDraftNow() {
    if (!draftLoadedRef.current) return
    writeDraft(sessionIdRef.current, currentDraftRef.current)
      .catch((error) => console.error('No se pudo guardar el avance.', error))
  }

  // Lo escrito tecla por tecla en la HV se guarda con una pequeña espera...
  useEffect(() => {
    if (!draftLoaded) return undefined
    const timer = window.setTimeout(saveDraftNow, 300)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftLoaded, cvForm])

  // ...y cada acción (guardar la HV, adjuntar un soporte, responder un test, cambiar de sección)
  // se guarda al instante, por si la persona cierra la app justo después.
  useEffect(() => {
    if (draftLoaded) saveDraftNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftLoaded, sessionId, photoFile, savedCvPdf, cvDirty, supportFiles, notApplicable, evaluations, evaluationConstancia, quizProgress, evaluationConstanciaDraft, syncedSignature, activeSection, generalDocumentId, quizMode])

  // Los envíos al servidor van en fila: uno a la vez y en orden, así un avance que tarda en subir
  // nunca pisa una versión más nueva (por ejemplo, la final de Terminar).
  const syncQueueRef = useRef(Promise.resolve())
  // Registro que ya envió su versión final: ningún avance parcial puede volver a subirse encima.
  const finalizedSessionRef = useRef(null)
  function enqueueSync(task) {
    const run = syncQueueRef.current.then(task)
    syncQueueRef.current = run.catch(() => {})
    return run
  }

  async function uploadResult(snapshot, snapshotSession, completo) {
    const pdfBlob = await buildResultPdf(snapshot, completo)
    return savePerson({
      // El id del registro: cada avance actualiza el mismo resultado en lugar de crear uno nuevo.
      id: snapshotSession,
      name: snapshot.savedCvPdf.candidateName,
      email: snapshot.savedCvPdf.candidateEmail,
      createdAt: new Date().toISOString(),
      pdfBlob,
      contact: snapshot.savedCvPdf.contact,
      completo,
      pasos: getResultSteps(snapshot),
      evaluaciones: summarizeEvaluations(snapshot.evaluations),
      constanciaEvaluaciones: snapshot.evaluationConstancia
        ? { firmada: true, cedula: snapshot.evaluationConstancia.cedula, cargo: snapshot.evaluationConstancia.cargo, fecha: snapshot.evaluationConstancia.at }
        : { firmada: false },
    })
  }

  // Desde que la persona guarda la HV, su PDF de respuesta se crea en Resultados y se actualiza
  // con cada sección que completa (soportes, constancia de inducción, test y su constancia).
  const resultSnapshot = { savedCvPdf, supportFiles, notApplicable, constancia, evaluationConstancia, evaluations }
  const resultSignature = savedCvPdf ? getResultSignature(resultSnapshot) : ''
  useEffect(() => {
    if (!draftLoaded || !savedCvPdf || resultSignature === syncedSignature) return undefined
    const snapshot = resultSnapshot
    const snapshotSession = sessionId
    const timer = window.setTimeout(() => {
      enqueueSync(async () => {
        // Si la persona ya terminó (o está terminando), este avance ya no aplica.
        if (sessionIdRef.current !== snapshotSession || finalizedSessionRef.current === snapshotSession) return
        setSyncStatus('saving')
        try {
          await uploadResult(snapshot, snapshotSession, false)
          if (sessionIdRef.current !== snapshotSession) return
          setSyncedSignature(resultSignature)
          setSyncStatus('saved')
        } catch (error) {
          console.error('No se pudo actualizar el resultado en el servidor.', error)
          if (sessionIdRef.current === snapshotSession) setSyncStatus('error')
        }
      })
    }, 1500)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftLoaded, resultSignature, syncedSignature, sessionId])

  // Si la persona recarga o cierra la pestaña antes de que corra el guardado diferido, se guarda ya.
  useEffect(() => {
    const handleHidden = () => {
      if (document.visibilityState === 'hidden') saveDraftNow()
    }
    window.addEventListener('pagehide', saveDraftNow)
    window.addEventListener('beforeunload', saveDraftNow)
    document.addEventListener('visibilitychange', handleHidden)
    return () => {
      window.removeEventListener('pagehide', saveDraftNow)
      window.removeEventListener('beforeunload', saveDraftNow)
      document.removeEventListener('visibilitychange', handleHidden)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // El formulario se desmonta al cambiar de sección: al volver se rellena con lo escrito.
  useEffect(() => {
    if (activeSection !== 'form' || !cvFormRef.current) return
    const values = cvValuesRef.current
    getCvInputs(cvFormRef.current).forEach((input, index) => {
      if (values[index] !== undefined) input.value = values[index]
    })
  }, [activeSection, draftLoaded, sessionId])

  useEffect(() => {
    if (quizFeedback || quizMode) generalMainRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [quizFeedback, quizMode])

  useEffect(() => {
    if (!photoFile) {
      setPhotoUrl('')
      return undefined
    }
    const url = URL.createObjectURL(photoFile)
    setPhotoUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photoFile])

  useEffect(() => {
    return () => {
      if (viewingPdf) URL.revokeObjectURL(viewingPdf.url)
    }
  }, [viewingPdf])

  function handlePhotoChange(event) {
    const file = event.target.files?.[0]
    if (file) setPhotoFile(file)
    event.target.value = ''
  }

  function handleRemovePhoto() {
    setPhotoFile(null)
  }

  function handleCvInput(event) {
    const form = event.currentTarget
    setCvDirty(true)
    setCvForm({ values: getCvInputs(form).map((input) => input.value), summary: getCvSummary(form) })
  }

  async function handleSupportUpload(id, event) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return

    const isPdf = file.name.toLowerCase().endsWith('.pdf')
      && (await file.slice(0, 5).text()) === '%PDF-'

    if (!isPdf) {
      setUploadErrors((current) => ({ ...current, [id]: 'Solo se permiten archivos PDF válidos.' }))
      input.value = ''
      return
    }

    setSupportFiles((current) => ({ ...current, [id]: file }))
    setNotApplicable((current) => ({ ...current, [id]: false }))
    setUploadErrors((current) => ({ ...current, [id]: '' }))
  }

  function handleNotApplicable(id, checked) {
    setNotApplicable((current) => ({ ...current, [id]: checked }))
    setUploadErrors((current) => ({ ...current, [id]: '' }))
    if (checked) {
      setSupportFiles((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
    }
  }

  function removeSupportFile(id) {
    setSupportFiles((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  async function handleSaveCv() {
    const form = document.querySelector('.hv-document')
    if (!form) return
    const invalidField = [...form.querySelectorAll('input[required]')]
      .find((input) => !input.reportValidity())
    if (invalidField) return

    setProcessing('saving')
    setWorkflowMessage(null)
    try {
      const result = await generateFormPdf(form)
      setSavedCvPdf({ ...result, savedAt: new Date().toISOString() })
      setCvDirty(false)
      setWorkflowMessage({
        type: 'success',
        text: 'Guardado correctamente. La HV en PDF quedará en Resultados al terminar el proceso.',
      })
    } catch (error) {
      console.error('No se pudo generar el PDF de la hoja de vida.', error)
      const tooLong = error.message?.includes('una sola página')
      setWorkflowMessage({
        type: 'error',
        text: tooLong
          ? 'La hoja de vida no cabe en una sola página. Acorta los textos más largos e inténtalo de nuevo.'
          : 'No se pudo generar el PDF. Inténtalo de nuevo.',
      })
    } finally {
      setProcessing('')
    }
  }

  function handleEvaluationComplete(documentId, mode, result) {
    const next = { ...evaluations, [documentId]: { ...evaluations[documentId], [mode]: result } }
    const allDone = GENERAL_INDUCTION_DOCUMENTS.every((document) => next[document.id]?.pos)
    setEvaluations(next)
    setQuizProgress((current) => {
      const remaining = { ...current }
      delete remaining[`${documentId}-${mode}`]
      return remaining
    })
    setQuizFeedback({ documentId, mode, allDone })
    setQuizMode('')
  }

  function handleSelectGeneralDocument(documentId) {
    setGeneralDocumentId(documentId)
    setQuizMode('')
    setQuizFeedback(null)
  }

  async function handleFinish() {
    if (!savedCvPdf || cvDirty) {
      setWorkflowMessage({
        type: 'error',
        text: 'Guarda la hoja de vida en la sección 1 antes de terminar.',
      })
      setActiveSection('form')
      return
    }

    if (!constancia) {
      setWorkflowMessage({
        type: 'error',
        text: 'Firma la constancia de inducción en la sección Inducción antes de terminar.',
      })
      setActiveSection('induction')
      return
    }

    if (!evaluationConstancia) {
      setWorkflowMessage({
        type: 'error',
        text: 'Completa los test de Inducción general y envía la constancia de evaluaciones antes de terminar.',
      })
      const pending = GENERAL_INDUCTION_DOCUMENTS.find((document) => !evaluations[document.id]?.pos)
      handleSelectGeneralDocument(pending ? pending.id : EVALUATION_CONSTANCIA_ID)
      setActiveSection('general-induction')
      return
    }

    const missingDocuments = SUPPORT_DOCUMENTS.filter(
      (document) => !supportFiles[document.id] && !notApplicable[document.id],
    )
    if (missingDocuments.length) {
      setWorkflowMessage({
        type: 'error',
        text: `Falta adjuntar o marcar como no aplica: ${missingDocuments.map((document) => document.label).join(', ')}.`,
      })
      return
    }

    setProcessing('finishing')
    setWorkflowMessage(null)
    try {
      // Espera a que terminen los avances pendientes y envía la versión final, ya sin página de avance.
      finalizedSessionRef.current = sessionId
      try {
        await enqueueSync(() => uploadResult(resultSnapshot, sessionId, true))
      } catch (error) {
        finalizedSessionRef.current = null
        throw error
      }

      // Proceso terminado: se borra el avance y la siguiente persona empieza un registro nuevo.
      await deleteDraft(sessionId).catch(() => {})
      clearConstancia(sessionId)
      setSessionId(startNewSession())
      setConstancia(null)
      setCvForm(EMPTY_CV_FORM)
      setPhotoFile(null)
      setSavedCvPdf(null)
      setCvDirty(true)
      setSupportFiles({})
      setNotApplicable({})
      setUploadErrors({})
      setEvaluations({})
      setEvaluationConstancia(null)
      setQuizProgress({})
      setEvaluationConstanciaDraft(null)
      setSyncedSignature('')
      setSyncStatus('')
      setQuizMode('')
      setQuizFeedback(null)
      setActiveSection('results')
      setWorkflowMessage({ type: 'success', text: 'Proceso terminado y resultado guardado correctamente.' })
    } catch (error) {
      console.error('No se pudo guardar el resultado PDF.', error)
      setWorkflowMessage({
        type: 'error',
        text: 'No se pudo combinar o guardar los PDF. Verifica que todos los archivos se abran correctamente.',
      })
    } finally {
      setProcessing('')
    }
  }

  function lockResults() {
    setResultsKey('')
    setSavedResults([])
    setResultsPassword('')
    setResultsPasswordError('')
  }

  // Si la clave deja de ser válida (por ejemplo, se cambió en el servidor), se vuelve a pedir.
  function handleResultsError(error) {
    if (error instanceof AccessDeniedError) {
      lockResults()
      setResultsPasswordError(error.message)
      return
    }
    setWorkflowMessage({ type: 'error', text: error.message })
  }

  async function getResultPdfBlob(result) {
    return getPersonPdf(result, resultsKey)
  }

  async function handleViewResult(result) {
    try {
      const url = URL.createObjectURL(await getResultPdfBlob(result))
      setViewingPdf({ url, filename: makeFilename(result.name, 'HV-y-soportes') })
    } catch (error) {
      handleResultsError(error)
    }
  }

  // La clave se valida en el servidor: si es correcta, devuelve la lista de resultados.
  async function handleResultsAccess(event) {
    event.preventDefault()
    const key = resultsPassword
    setResultsLoading(true)
    setResultsPasswordError('')
    try {
      const people = await getPeopleDatabase(key)
      setSavedResults(people)
      setResultsKey(key)
      setResultsPassword('')
    } catch (error) {
      setResultsPasswordError(error instanceof AccessDeniedError ? error.message : 'No se pudieron cargar los resultados. Inténtalo de nuevo.')
    } finally {
      setResultsLoading(false)
    }
  }

  function handleSectionNavigation(section) {
    if (section !== 'results') lockResults()
    setActiveSection(section)
  }

  async function handleDownloadResult(result) {
    try {
      const url = URL.createObjectURL(await getResultPdfBlob(result))
      const link = document.createElement('a')
      link.href = url
      link.download = makeFilename(result.name, 'HV-y-soportes')
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (error) {
      handleResultsError(error)
    }
  }

  async function handleDeleteResult(result) {
    const confirmed = window.confirm(`¿Eliminar el resultado de ${result.name} y su PDF?`)
    if (!confirmed) return

    try {
      await deletePerson(result.id, resultsKey)
      setSavedResults((current) => current.filter((savedResult) => savedResult.id !== result.id))
      setWorkflowMessage({ type: 'success', text: 'Resultado eliminado correctamente.' })
    } catch (error) {
      handleResultsError(error)
    }
  }

  const cvSaved = Boolean(savedCvPdf) && !cvDirty
  const resolvedSupports = SUPPORT_DOCUMENTS.filter(
    (document) => supportFiles[document.id] || notApplicable[document.id],
  ).length
  const supportsComplete = resolvedSupports === SUPPORT_DOCUMENTS.length
  const inductionSigned = Boolean(constancia)
  const generalDocument = GENERAL_INDUCTION_DOCUMENTS.find((document) => document.id === generalDocumentId)
  const generalEvaluation = evaluations[generalDocumentId] || {}
  const completedEvaluations = GENERAL_INDUCTION_DOCUMENTS
    .filter((document) => evaluations[document.id]?.pre && evaluations[document.id]?.pos)
    .map((document) => document.id)
  const allEvaluationsDone = completedEvaluations.length === GENERAL_INDUCTION_DOCUMENTS.length
  const evaluationsSigned = Boolean(evaluationConstancia)
  const stepsDone = Number(cvSaved) + Number(supportsComplete) + Number(inductionSigned) + Number(evaluationsSigned)

  return (
    <div className="assessment-page">
      <header className="topbar">
        <div className="brand-block" aria-label="SanitHelp logo">
          <img src={logoSanitHelp} alt="SanitHelp" className="brand-logo" />
        </div>

        <div className="header-title">
          <strong>HV SanitHelp</strong>
          <span>Portal de ingreso y actualización · Gestión Humana - SST</span>
        </div>

        <div className="header-badge">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Información confidencial</span>
        </div>
      </header>

      <div className="workflow-layout">
        <aside className="sidebar">
          <span className="sidebar-label">Proceso</span>
          <nav className="menu-list" aria-label="Menú de secciones">
            {MENU_ITEMS.map(({ id, label, hint, icon: Icon }) => {
              const done = (id === 'form' && cvSaved)
                || (id === 'supports' && supportsComplete)
                || (id === 'induction' && inductionSigned)
                || (id === 'general-induction' && evaluationsSigned)
              return (
                <button
                  key={id}
                  type="button"
                  className={`menu-item ${id === 'results' ? 'menu-item-results' : ''} ${activeSection === id ? 'active' : ''} ${done ? 'done' : ''}`}
                  aria-current={activeSection === id ? 'page' : undefined}
                  onClick={() => {
                    if (id === 'results') {
                      setWorkflowMessage(null)
                      setActiveSection('results')
                      return
                    }
                    handleSectionNavigation(id)
                  }}
                >
                  <span className="item-icon" aria-hidden="true">
                    {done ? <Check size={17} strokeWidth={2.6} /> : <Icon size={18} />}
                  </span>
                  <span className="item-text">
                    <strong>{label}</strong>
                    <small>{done ? 'Completado' : hint}</small>
                  </span>
                  {id === 'results' && <Lock size={14} className="item-lock" aria-hidden="true" />}
                </button>
              )
            })}
          </nav>

          <div className="sidebar-progress">
            <div className="sidebar-progress-head">
              <span>Tu avance</span>
              <strong>{stepsDone} / 4</strong>
            </div>
            <div className="progress-track" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${(stepsDone / 4) * 100}%` }} />
            </div>
            <p>Guarda la HV, adjunta los soportes, firma la constancia de inducción y envía la constancia de los test para terminar.</p>
            <p className="sidebar-autosave">
              <Save size={13} aria-hidden="true" />
              Tu avance se guarda solo en este equipo: puedes salir y continuar después.
            </p>
            {syncStatus && (
              <p className={`sidebar-sync ${syncStatus}`} role="status">
                {syncStatus === 'saving'
                  ? 'Actualizando tu PDF de respuesta...'
                  : syncStatus === 'saved'
                    ? 'Tu PDF de respuesta está guardado y al día.'
                    : 'No se pudo actualizar tu PDF de respuesta. Se reintentará con tu próximo avance.'}
              </p>
            )}
          </div>
        </aside>

        <main className="main-panel">
          <div className="section-stack">
            {workflowMessage && (
              <div className={`workflow-message ${workflowMessage.type}`} role="status">
                {workflowMessage.type === 'success'
                  ? <CheckCircle2 size={18} aria-hidden="true" />
                  : <AlertCircle size={18} aria-hidden="true" />}
                <span>{workflowMessage.text}</span>
                <button
                  type="button"
                  className="workflow-message-close"
                  onClick={() => setWorkflowMessage(null)}
                  aria-label="Cerrar mensaje"
                >
                  <X size={15} />
                </button>
              </div>
            )}

            {activeSection === 'form' ? <section className="hv-document" ref={cvFormRef} onInput={handleCvInput}>
              <div className="document-head">
                <div className="company-brand">
                  <img src={logoSanitHelp} alt="SanitHelp" className="document-brand-logo" />
                </div>
                <div className="document-title">
                  <span>HOJA DE VIDA</span>
                  <strong>DE INGRESO Y ACTUALIZACIÓN</strong>
                </div>
              </div>

              <div className="document-grid">
                <div className="form-row top-row">
                  <FormField label="Fecha de actualización" type="date" />
                  <FormField label="Cargo" />
                  <FormField label="Dependencia" />
                </div>

                <div className="personal-layout">
                  <div className="personal-fields">
                    <div className="form-row two-fields">
                        <FormField label="Apellidos" required />
                          <FormField label="Nombres" required />
                    </div>
                    <div className="form-row two-fields">
                      <FormField label="Documento de identidad" />
                      <FormField label="Lugar de expedición" />
                    </div>
                    <div className="form-row two-fields">
                      <FormField label="Dirección de domicilio" />
                      <FormField label="Barrio" />
                    </div>
                    <div className="form-row three-fields">
                      <FormField label="Ciudad o municipio" />
                      <FormField label="Teléfono" type="tel" />
                      <FormField label="Celular" type="tel" />
                    </div>
                    <div className="form-row two-fields">
                      <FormField label="Correo personal" type="email" required />
                      <FormField label="Estado civil" />
                    </div>
                    <div className="form-row three-fields">
                      <FormField label="Fecha de nacimiento" type="date" />
                      <FormField label="Lugar de nacimiento" />
                      <FormField label="Profesión" />
                    </div>
                    <div className="form-row three-fields">
                      <FormField label="Años de experiencia" type="number" />
                      <FormField label="Estatura (m)" type="number" />
                      <FormField label="Peso (kg)" type="number" />
                    </div>
                  </div>

                  <div className="photo-panel">
                    <div className="photo-box">
                      {photoUrl ? <img src={photoUrl} alt="Foto de perfil" /> : <span>FOTO</span>}
                      {photoUrl && (
                        <button type="button" className="remove-photo-btn" onClick={handleRemovePhoto} aria-label="Quitar foto" title="Quitar foto">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    <label className="upload-photo-btn">
                      <Upload size={14} />
                      <span>Adjuntar foto</span>
                      <input type="file" accept="image/*" onChange={handlePhotoChange} />
                    </label>
                  </div>
                </div>

                <div className="education-section">
                  <h2>Educación</h2>
                  <div className="education-row education-heading">
                    <span>Nivel</span>
                    <span>Institución</span>
                    <span>Ciudad o municipio</span>
                    <span>Año</span>
                  </div>
                  {['Primaria', 'Bachillerato', 'Educación superior'].map((level) => (
                    <div className="education-row" key={level}>
                      <span className="education-level">{level}</span>
                      <input aria-label={`Institución de ${level}`} />
                      <input aria-label={`Ciudad de ${level}`} />
                      <input aria-label={`Año de ${level}`} type="number" />
                    </div>
                  ))}
                  <div className="form-row two-fields">
                    <FormField label="Título obtenido" />
                    <FormField label="Tipo de formación" />
                  </div>
                </div>

                <section className="form-section">
                  <h2>Estudios actuales</h2>
                  <div className="form-row two-fields">
                    <FormField label="¿Qué estudios realiza actualmente?" />
                    <FormField label="Institución y horario" />
                  </div>
                </section>

                <section className="form-section">
                  <h2>Experiencia laboral</h2>
                  <div className="form-row three-fields">
                    <FormField label="Nombre de la última empresa" />
                    <FormField label="Dirección" />
                    <FormField label="Teléfono" type="tel" />
                  </div>
                  <div className="form-row three-fields">
                    <FormField label="Cargo desempeñado" />
                    <FormField label="Nombre del jefe inmediato" />
                    <FormField label="Área o dependencia" />
                  </div>
                  <div className="form-row two-fields">
                    <FormField label="Funciones realizadas" />
                    <FormField label="Motivo de retiro" />
                  </div>
                  <div className="form-row four-fields">
                    <FormField label="Fecha de ingreso" type="date" />
                    <FormField label="Fecha de retiro" type="date" />
                    <FormField label="Salario inicial" type="number" />
                    <FormField label="Salario final" type="number" />
                  </div>
                </section>

                <section className="form-section">
                  <h2>Información familiar</h2>
                  <div className="form-row three-fields">
                    <FormField label="Nombre del acudiente" />
                    <FormField label="Parentesco" />
                    <FormField label="Teléfono o celular" type="tel" />
                  </div>
                  <div className="form-row two-fields">
                    <FormField label="Dirección" />
                    <FormField label="Nombre del familiar de contacto" />
                  </div>
                </section>

                <section className="form-section">
                  <h2>Información corporativa</h2>
                  <div className="form-row two-fields">
                    <FormField label="Socio(a) a" />
                    <FormField label="Correo" type="email" />
                  </div>
                  <div className="form-row three-fields">
                    <FormField label="Celular" type="tel" />
                    <FormField label="No. de cuenta de nómina" />
                    <FormField label="Banco" />
                  </div>
                  <div className="form-row three-fields">
                    <FormField label="Jefe inmedianto" />
                    <FormField label="EPS" />
                    <FormField label="ARL" />
                  </div>
                </section>

                <section className="signature-section">
                  <FormField label="Firma" />
                </section>
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="primary-action"
                  onClick={handleSaveCv}
                  disabled={Boolean(processing)}
                >
                  <Save size={17} aria-hidden="true" />
                  {processing === 'saving' ? 'Generando PDF...' : 'Guardar'}
                </button>
              </div>
            </section> : activeSection === 'supports' ? (
              <section className="support-page" aria-labelledby="supports-title">
                <div className="support-page-header">
                  <div>
                    <h1 id="supports-title">Soportes para hoja de vida</h1>
                    <p>Adjunta cada soporte en formato PDF.</p>
                  </div>
                  <span className={`support-count ${supportsComplete ? 'complete' : ''}`}>
                    {resolvedSupports} / {SUPPORT_DOCUMENTS.length} listos
                  </span>
                </div>
                <div className="progress-track support-progress" aria-hidden="true">
                  <div
                    className="progress-fill"
                    style={{ width: `${(resolvedSupports / SUPPORT_DOCUMENTS.length) * 100}%` }}
                  />
                </div>

                <div className="support-list">
                  {SUPPORT_DOCUMENTS.map((document, index) => {
                    const file = supportFiles[document.id]
                    const skipped = Boolean(notApplicable[document.id])
                    const error = uploadErrors[document.id]

                    return (
                      <article
                        className={`support-row ${file ? 'is-attached' : ''} ${skipped ? 'is-skipped' : ''}`}
                        key={document.id}
                      >
                        <div className="support-description">
                          <span className="support-index">
                            {file ? <Check size={15} strokeWidth={2.6} aria-hidden="true" /> : String(index + 1).padStart(2, '0')}
                          </span>
                          <div>
                            <h2>{document.label}</h2>
                            {document.detail && <p>{document.detail}</p>}
                          </div>
                        </div>

                        <div className="support-controls">
                          {file ? (
                            <div className="attached-file">
                              <FileText size={17} aria-hidden="true" />
                              <span title={file.name}>{file.name}</span>
                              <button
                                type="button"
                                className="remove-file"
                                onClick={() => removeSupportFile(document.id)}
                                aria-label={`Quitar ${file.name}`}
                                title="Quitar archivo"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ) : (
                            <label className={`support-upload ${skipped ? 'disabled' : ''}`}>
                              <Upload size={16} aria-hidden="true" />
                              <span>Adjuntar PDF</span>
                              <input
                                type="file"
                                accept=".pdf,application/pdf"
                                disabled={skipped}
                                onChange={(event) => handleSupportUpload(document.id, event)}
                              />
                            </label>
                          )}
                          {document.id !== 'completed-cv' && (
                            <label className="not-applicable">
                              <input
                                type="checkbox"
                                checked={skipped}
                                onChange={(event) => handleNotApplicable(document.id, event.target.checked)}
                              />
                              <span>No aplica</span>
                            </label>
                          )}
                        </div>
                        {error && <p className="upload-error" role="alert">{error}</p>}
                        {skipped && <p className="upload-status">Marcado como no aplica</p>}
                      </article>
                    )
                  })}
                </div>
                <div className="support-footer">
                  <button
                    type="button"
                    className="primary-action"
                    onClick={handleFinish}
                    disabled={Boolean(processing)}
                  >
                    <CheckCircle2 size={17} aria-hidden="true" />
                    {processing === 'finishing' ? 'Guardando PDF...' : 'Terminar'}
                  </button>
                </div>
              </section>
            ) : activeSection === 'general-induction' ? (
              <section className="induction-page general-induction" aria-labelledby="general-induction-title">
                <header className="induction-header">
                  <div className="induction-heading">
                    <ScrollText size={22} aria-hidden="true" />
                    <div>
                      <span>INDUCCIÓN GENERAL</span>
                      <h1 id="general-induction-title">Políticas SST</h1>
                    </div>
                  </div>
                </header>
                <div className="general-induction-layout">
                  <nav className="general-document-list" aria-label="Documentos de inducción general">
                    {GENERAL_INDUCTION_DOCUMENTS.map((document) => (
                      <button
                        key={document.id}
                        type="button"
                        className={`general-document ${document.id === generalDocumentId ? 'active' : ''}`}
                        aria-current={document.id === generalDocumentId ? 'true' : undefined}
                        onClick={() => handleSelectGeneralDocument(document.id)}
                      >
                        <FileText size={17} aria-hidden="true" />
                        <span>
                          <small>{document.code}</small>
                          <strong>{document.title}</strong>
                          <em className={`evaluation-chip ${completedEvaluations.includes(document.id) ? 'passed' : ''}`}>
                            {completedEvaluations.includes(document.id)
                              ? 'Completado'
                              : evaluations[document.id]?.pre ? 'Pos-test pendiente' : 'Pre-test pendiente'}
                          </em>
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`general-document general-document-constancia ${generalDocumentId === EVALUATION_CONSTANCIA_ID ? 'active' : ''} ${allEvaluationsDone ? '' : 'locked'}`}
                      aria-current={generalDocumentId === EVALUATION_CONSTANCIA_ID ? 'true' : undefined}
                      onClick={() => handleSelectGeneralDocument(EVALUATION_CONSTANCIA_ID)}
                    >
                      {allEvaluationsDone ? <FileSignature size={17} aria-hidden="true" /> : <Lock size={17} aria-hidden="true" />}
                      <span>
                        <small>Formulario</small>
                        <strong>Constancia de evaluaciones</strong>
                        <em className={`evaluation-chip ${evaluationConstancia ? 'passed' : allEvaluationsDone ? 'ready' : ''}`}>
                          {evaluationConstancia ? 'Enviada' : allEvaluationsDone ? 'Disponible' : `Bloqueada · ${completedEvaluations.length} de ${GENERAL_INDUCTION_DOCUMENTS.length}`}
                        </em>
                      </span>
                    </button>
                  </nav>
                  <div className="general-induction-main" ref={generalMainRef}>
                    {generalDocumentId === EVALUATION_CONSTANCIA_ID ? (
                      <ConstanciaEvaluaciones
                        key={evaluationConstancia?.at || 'nueva'}
                        documentos={GENERAL_INDUCTION_DOCUMENTS}
                        completados={completedEvaluations}
                        initial={cvForm.summary}
                        sent={evaluationConstancia}
                        draft={evaluationConstanciaDraft}
                        onDraftChange={setEvaluationConstanciaDraft}
                        onSubmit={(submitted) => {
                          setEvaluationConstancia(submitted)
                          setEvaluationConstanciaDraft(null)
                        }}
                      />
                    ) : !generalEvaluation.pre || quizMode === 'pos' ? (
                      <Evaluacion
                        key={`${generalDocument.id}-${generalEvaluation.pre ? 'pos' : 'pre'}`}
                        documento={generalDocument}
                        modo={generalEvaluation.pre ? 'pos' : 'pre'}
                        initialAnswers={quizProgress[`${generalDocument.id}-${generalEvaluation.pre ? 'pos' : 'pre'}`]}
                        onAnswersChange={(answers) => setQuizProgress((current) => ({ ...current, [`${generalDocument.id}-${generalEvaluation.pre ? 'pos' : 'pre'}`]: answers }))}
                        onCancel={generalEvaluation.pre ? () => setQuizMode('') : undefined}
                        onComplete={(result) => handleEvaluationComplete(generalDocument.id, generalEvaluation.pre ? 'pos' : 'pre', result)}
                      />
                    ) : (
                      <>
                        {quizFeedback?.documentId === generalDocument.id && (
                          <div className="evaluation-feedback ok" role="status">
                            <span>
                              {quizFeedback.mode === 'pre'
                                ? 'Pre-test enviado. Ahora revisa la presentación completa y luego presenta el pos-test.'
                                : quizFeedback.allDone
                                  ? '¡Completaste el pre-test y el pos-test de todas las políticas! Envía tus test a la constancia de evaluaciones.'
                                  : 'Pos-test enviado. Esta política quedó completada.'}
                            </span>
                            {quizFeedback.mode === 'pos' && quizFeedback.allDone && (
                              <button type="button" className="primary-action" onClick={() => handleSelectGeneralDocument(EVALUATION_CONSTANCIA_ID)}>
                                <Send size={16} aria-hidden="true" />
                                Enviar
                              </button>
                            )}
                          </div>
                        )}
                        <div className="evaluation-bar">
                          <div className="evaluation-scores">
                            <span>Pre-test <strong>{completionLabel(generalEvaluation.pre)}</strong></span>
                            <span>Pos-test <strong>{completionLabel(generalEvaluation.pos)}</strong></span>
                            {generalEvaluation.pos && <span className="evaluation-passed"><Check size={15} aria-hidden="true" /> Política completada</span>}
                          </div>
                          {!generalEvaluation.pos && (
                            <button type="button" className="primary-action" onClick={() => { setQuizFeedback(null); setQuizMode('pos') }}>
                              <ClipboardCheck size={17} aria-hidden="true" />
                              Presentar pos-test
                            </button>
                          )}
                        </div>
                        <PdfViewer
                          key={generalDocument.file}
                          className="induction-pdf general-induction-pdf"
                          url={`/induccion-general/${generalDocument.file}`}
                          title={`${generalDocument.code} ${generalDocument.title}`}
                        />
                      </>
                    )}
                  </div>
                </div>
              </section>
            ) : activeSection === 'induction' ? (
              <section className="induction-page" aria-labelledby="induction-title">
                <header className="induction-header">
                  <div className="induction-heading">
                    <BookOpen size={22} aria-hidden="true" />
                    <div>
                      <span>INDUCCIÓN</span>
                      <h1 id="induction-title">Gestión Humana SanitHelp</h1>
                    </div>
                  </div>
                  <div className="induction-links">
                    <a
                      className="induction-open-link"
                      href={getConstanciaPageUrl(sessionId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={17} aria-hidden="true" />
                      {inductionSigned ? 'Firmar de nuevo' : 'Firmar constancia'}
                    </a>
                  </div>
                </header>
                {inductionSigned ? (
                  <p className="induction-status done" role="status">
                    <CheckCircle2 size={17} aria-hidden="true" />
                    Constancia firmada por {constancia.name || 'el colaborador'}. Irá al principio del PDF al pulsar Terminar.
                  </p>
                ) : (
                  <p className="induction-status pending" role="status">
                    <span className="induction-status-icon" aria-hidden="true">
                      <TriangleAlert size={18} strokeWidth={2.4} />
                    </span>
                    Lee la inducción y llena el formulario de constancia de inducción.
                  </p>
                )}
                <PdfViewer
                  className="induction-pdf"
                  url="/Induccion_Gestion_Humana_SanitHelp_1.pdf"
                  title="Inducción Gestión Humana SanitHelp"
                  resolveLink={(url) => (url === INDUCTION_FORM_URL ? getConstanciaPageUrl(sessionId) : url)}
                />
              </section>
            ) : !resultsKey ? (
              <section className="results-access" aria-labelledby="results-access-title">
                <div className="results-access-icon" aria-hidden="true">
                  <KeyRound size={25} />
                </div>
                <span className="results-access-kicker">Acceso privado</span>
                <h1 id="results-access-title">Respuestas</h1>
                <p>Introduce la clave para abrir el archivo de pruebas.</p>
                <form onSubmit={handleResultsAccess}>
                  <label htmlFor="results-password">Clave de acceso</label>
                  <input
                    id="results-password"
                    type="password"
                    autoComplete="current-password"
                    value={resultsPassword}
                    onChange={(event) => setResultsPassword(event.target.value)}
                    required
                  />
                  {resultsPasswordError && <span className="results-password-error" role="alert">{resultsPasswordError}</span>}
                  <button type="submit" className="primary-action" disabled={resultsLoading}>
                    <KeyRound size={19} aria-hidden="true" />
                    {resultsLoading ? 'Verificando...' : 'Abrir respuestas'}
                  </button>
                </form>
              </section>
            ) : (
              <section className="results-page" aria-labelledby="results-title">
                <header className="results-heading">
                  <span>ARCHIVO DE HOJAS DE VIDA</span>
                  <h1 id="results-title">Resultados guardados</h1>
                  <p>Hojas de vida y soportes en PDF.</p>
                </header>
                <div className="results-list">
                  <div className="results-list-heading">
                    <h2>Personas</h2>
                    <span>{savedResults.length}</span>
                  </div>
                  {savedResults.length ? savedResults.map((result) => (
                    <article className="result-row" key={result.id}>
                      <div className="result-person">
                        <span className="result-avatar" aria-hidden="true">{getInitials(result.name)}</span>
                        <div className="result-meta">
                          <strong>{result.name}</strong>
                          {result.completo === false ? (
                            <span className="result-status in-progress">
                              En progreso · {RESULT_STEPS.filter((step) => result.pasos?.[step.id]).length} / {RESULT_STEPS.length}
                            </span>
                          ) : (
                            <span className="result-status complete">Completo</span>
                          )}
                        </div>
                      </div>
                      <div className="result-actions">
                        <button
                          type="button"
                          className="view-result-button"
                          onClick={() => handleViewResult(result)}
                          aria-label={`Ver PDF de ${result.name}`}
                          title="Ver PDF"
                        >
                          <Eye size={18} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="view-result-button"
                          onClick={() => handleDownloadResult(result)}
                          aria-label={`Descargar PDF de ${result.name}`}
                          title="Descargar PDF"
                        >
                          <Download size={18} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="view-result-button delete-result-button"
                          onClick={() => handleDeleteResult(result)}
                          aria-label={`Eliminar resultado de ${result.name}`}
                          title="Eliminar resultado"
                        >
                          <Trash2 size={18} aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  )) : (
                    <div className="results-empty">
                      <Archive size={28} aria-hidden="true" />
                      <p>Aún no hay resultados guardados.</p>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        </main>
      </div>
      {viewingPdf && (
        <div className="pdf-viewer-backdrop">
          <section className="pdf-viewer" role="dialog" aria-modal="true" aria-label="Visor de PDF">
            <header className="pdf-viewer-header">
              <strong>{viewingPdf.filename}</strong>
              <div>
                <button type="button" onClick={() => setViewingPdf(null)} aria-label="Cerrar PDF" title="Cerrar PDF">
                  <X size={18} />
                </button>
              </div>
            </header>
            <iframe src={viewingPdf.url} title={viewingPdf.filename} />
          </section>
        </div>
      )}
    </div>
  )
}
