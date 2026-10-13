// store.js — estado en memoria de la aplicación, mutaciones y eventos.
// Toda la persistencia pasa por db.js. Las escrituras se agrupan (debounce).

import * as db from './db.js';
import { defaultSettings, defaultTextElement, defaultShapeElement, pageDimensions } from './constants.js';

// ---- utilidades --------------------------------------------------------
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return Date.now();
}

// ---- emitter -----------------------------------------------------------
const listeners = new Map();

export function on(event, cb) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(cb);
  return () => listeners.get(event).delete(cb);
}

function emit(event, payload) {
  (listeners.get(event) || []).forEach((cb) => cb(payload));
}

// ---- estado ------------------------------------------------------------
export const state = {
  fanzineList: [], // metadatos ligeros para el modal
  current: null, // documento completo abierto
  pageIndex: 0,
  selectedLayerId: null,
  assetUrls: new Map(), // assetId -> objectURL
};

let saveTimer = null;

function scheduleSave() {
  if (!state.current) return;
  scheduleHistory();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveCurrent().catch((err) => console.error('No se pudo guardar', err));
  }, 400);
}

// Callbacks que se ejecutan justo antes de guardar o de cambiar de página.
// Se usan para capturar la edición de texto "en curso" del lienzo (el texto
// vive en el contenteditable, no en el modelo) antes de que se destruya.
const preCommit = new Set();
export function onBeforeSave(cb) {
  preCommit.add(cb);
  return () => preCommit.delete(cb);
}
function runPreCommit() {
  for (const cb of [...preCommit]) cb();
}

export async function saveCurrent() {
  if (!state.current) return;
  runPreCommit();
  state.current.updatedAt = now();
  await db.putFanzine(state.current);
  // refresca metadatos de la lista
  const meta = toMeta(state.current);
  const i = state.fanzineList.findIndex((f) => f.id === meta.id);
  if (i >= 0) state.fanzineList[i] = meta;
  else state.fanzineList.push(meta);
  state.fanzineList.sort((a, b) => b.updatedAt - a.updatedAt);
  emit('fanzineList:changed');
}

function toMeta(doc) {
  return {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    pages: doc.pages.length,
  };
}

// Relee la lista de fanzines desde IndexedDB (tras importar, por ejemplo).
export async function reloadList() {
  const docs = await db.getAllFanzines();
  state.fanzineList = docs.map(toMeta).sort((a, b) => b.updatedAt - a.updatedAt);
  emit('fanzineList:changed');
}

// ---- historial (deshacer / rehacer) ------------------------------------
// Guarda instantáneas del documento (ajustes + páginas). Las mutaciones
// programan una captura con retardo para agrupar cambios rápidos (arrastres,
// sliders) en una sola entrada.
const history = { entries: [], index: -1, timer: null };
const MAX_HISTORY = 100;

function snapshot() {
  return JSON.stringify({ settings: state.current.settings, pages: state.current.pages, pageIndex: state.pageIndex });
}

function scheduleHistory() {
  if (!state.current) return;
  clearTimeout(history.timer);
  history.timer = setTimeout(commitHistory, 300);
}

function commitHistory() {
  if (!state.current) return;
  const snap = snapshot();
  if (history.index >= 0 && history.entries[history.index] === snap) return;
  history.entries = history.entries.slice(0, history.index + 1);
  history.entries.push(snap);
  if (history.entries.length > MAX_HISTORY) history.entries.shift();
  history.index = history.entries.length - 1;
  emit('history:changed');
}

function resetHistory() {
  clearTimeout(history.timer);
  history.entries = state.current ? [snapshot()] : [];
  history.index = state.current ? 0 : -1;
  emit('history:changed');
}

export function canUndo() {
  return history.index > 0;
}

export function canRedo() {
  return history.index >= 0 && history.index < history.entries.length - 1;
}

function applySnapshot(snap) {
  const data = JSON.parse(snap);
  state.current.settings = data.settings;
  state.current.pages = data.pages;
  if (typeof data.pageIndex === 'number') state.pageIndex = data.pageIndex;
  if (state.pageIndex >= state.current.pages.length) state.pageIndex = state.current.pages.length - 1;
  if (state.pageIndex < 0) state.pageIndex = 0;
  state.selectedLayerId = null;
  emit('settings:changed');
  emit('pages:changed');
  emit('layers:changed');
  emit('canvas:changed');
  emit('selection:changed');
  scheduleSave();
}

export function undo() {
  if (!state.current) return false;
  clearTimeout(history.timer);
  commitHistory();
  if (history.index <= 0) return false;
  history.index -= 1;
  applySnapshot(history.entries[history.index]);
  emit('history:changed');
  return true;
}

export function redo() {
  if (!state.current) return false;
  clearTimeout(history.timer);
  commitHistory();
  if (history.index >= history.entries.length - 1) return false;
  history.index += 1;
  applySnapshot(history.entries[history.index]);
  emit('history:changed');
  return true;
}

// ---- portapapeles interno ----------------------------------------------
// Copia/pega de páginas y capas sin pasar por el portapapeles del sistema.
let clipboard = null;

export function hasClipboard() {
  return !!clipboard;
}

export function copySelection() {
  if (!state.current) return null;
  if (state.selectedLayerId) {
    const layer = getLayer(state.selectedLayerId);
    if (!layer) return null;
    clipboard = { kind: 'layer', data: JSON.parse(JSON.stringify(layer)) };
    return 'layer';
  }
  const page = currentPage();
  if (!page) return null;
  clipboard = { kind: 'page', data: { elements: JSON.parse(JSON.stringify(page.elements)) } };
  return 'page';
}

export function pasteClipboard() {
  if (!state.current || !clipboard) return null;
  if (clipboard.kind === 'layer') {
    const page = currentPage();
    const dims = pageDims();
    const src = clipboard.data;
    const el = { ...src, id: uid('el'), z: nextZ(page) };
    const step = 16;
    el.x = Math.max(0, Math.min(Math.max(0, dims.width - el.w), (src.x || 0) + step));
    el.y = Math.max(0, Math.min(Math.max(0, dims.height - el.h), (src.y || 0) + step));
    page.elements.push(el);
    state.selectedLayerId = el.id;
    emit('layers:changed');
    emit('canvas:changed');
    emit('selection:changed');
    scheduleSave();
    return 'layer';
  }
  const copy = {
    id: uid('pg'),
    elements: clipboard.data.elements.map((e) => ({ ...e, id: uid('el') })),
  };
  state.current.pages.splice(state.pageIndex + 1, 0, copy);
  state.pageIndex += 1;
  state.selectedLayerId = null;
  emit('pages:changed');
  emit('canvas:changed');
  scheduleSave();
  return 'page';
}

// ---- ciclo de fanzines -------------------------------------------------
export async function init() {
  const docs = await db.getAllFanzines();
  state.fanzineList = docs.map(toMeta).sort((a, b) => b.updatedAt - a.updatedAt);
  emit('fanzineList:changed');
  if (state.fanzineList.length) {
    await openFanzine(state.fanzineList[0].id);
  } else {
    await createFanzine();
  }
}

export async function createFanzine(name) {
  const doc = {
    id: uid('fz'),
    name: name || `Fanzine ${new Date().toLocaleDateString('es')}`,
    createdAt: now(),
    updatedAt: now(),
    settings: defaultSettings(),
    pages: [newPage()],
  };
  await db.putFanzine(doc);
  state.fanzineList.unshift(toMeta(doc));
  await openFanzine(doc.id);
  emit('fanzineList:changed');
  return doc;
}

function newPage() {
  return { id: uid('pg'), elements: [] };
}

export async function openFanzine(id) {
  await flushSave();
  releaseAssetUrls();
  const doc = await db.getFanzine(id);
  if (!doc) return;
  state.current = doc;
  state.pageIndex = 0;
  state.selectedLayerId = null;
  await preloadAssets(doc);
  resetHistory();
  emit('fanzine:opened');
  emit('all:changed');
}

export async function deleteFanzine(id) {
  const doc = await db.getFanzine(id);
  // borra assets referenciados
  if (doc) {
    const ids = new Set();
    for (const page of doc.pages) for (const el of page.elements) if (el.assetId) ids.add(el.assetId);
    for (const assetId of ids) await db.deleteAsset(assetId);
  }
  await db.deleteFanzine(id);
  state.fanzineList = state.fanzineList.filter((f) => f.id !== id);
  emit('fanzineList:changed');
  if (state.current && state.current.id === id) {
    releaseAssetUrls();
    state.current = null;
    if (state.fanzineList.length) await openFanzine(state.fanzineList[0].id);
    else await createFanzine();
  }
}

// ---- assets ------------------------------------------------------------
async function preloadAssets(doc) {
  const ids = new Set();
  for (const page of doc.pages) for (const el of page.elements) if (el.assetId) ids.add(el.assetId);
  for (const id of ids) {
    const asset = await db.getAsset(id);
    if (asset) state.assetUrls.set(id, URL.createObjectURL(asset.blob));
  }
}

function releaseAssetUrls() {
  for (const url of state.assetUrls.values()) URL.revokeObjectURL(url);
  state.assetUrls.clear();
}

export async function addImageAsset(file) {
  const id = uid('as');
  await db.putAsset({ id, name: file.name, type: file.type, blob: file });
  state.assetUrls.set(id, URL.createObjectURL(file));
  return { id, name: file.name };
}

export function assetUrl(id) {
  return state.assetUrls.get(id) || null;
}

// ---- ajustes de página ------------------------------------------------
export function setSettings(patch) {
  Object.assign(state.current.settings, patch);
  emit('settings:changed');
  emit('canvas:changed');
  scheduleSave();
}

export function pageDims() {
  return pageDimensions(state.current.settings);
}

// ---- páginas -----------------------------------------------------------
export function currentPage() {
  return state.current.pages[state.pageIndex];
}

export function addPage() {
  runPreCommit();
  state.current.pages.splice(state.pageIndex + 1, 0, newPage());
  state.pageIndex += 1;
  state.selectedLayerId = null;
  emit('pages:changed');
  emit('canvas:changed');
  scheduleSave();
}

export function deletePage() {
  if (state.current.pages.length <= 1) return;
  runPreCommit();
  state.current.pages.splice(state.pageIndex, 1);
  state.pageIndex = Math.max(0, state.pageIndex - 1);
  state.selectedLayerId = null;
  emit('pages:changed');
  emit('canvas:changed');
  scheduleSave();
}

export function gotoPage(index) {
  if (index < 0 || index >= state.current.pages.length) return;
  runPreCommit();
  state.pageIndex = index;
  state.selectedLayerId = null;
  emit('pages:changed');
  emit('canvas:changed');
}

// Mueve una página dentro del documento. `delta` -1 sube, +1 baja.
export function movePage(index, delta) {
  const pages = state.current.pages;
  const j = index + delta;
  if (index < 0 || j < 0 || j >= pages.length) return;
  [pages[index], pages[j]] = [pages[j], pages[index]];
  // la página actual (y la selección) siguen a la página movida
  if (state.pageIndex === index) state.pageIndex = j;
  else if (state.pageIndex === j) state.pageIndex = index;
  emit('pages:changed');
  emit('canvas:changed');
  scheduleSave();
}

// Duplica una página con todas sus capas e inserta la copia justo debajo.
export function duplicatePage(index) {
  const pages = state.current.pages;
  if (index < 0 || index >= pages.length) return null;
  runPreCommit();
  const src = pages[index];
  const copy = {
    id: uid('pg'),
    elements: src.elements.map((e) => ({ ...e, id: uid('el') })),
  };
  pages.splice(index + 1, 0, copy);
  state.pageIndex = index + 1;
  state.selectedLayerId = null;
  emit('pages:changed');
  emit('canvas:changed');
  scheduleSave();
  return copy;
}

// ---- capas -------------------------------------------------------------
function nextZ(page) {
  return page.elements.reduce((max, el) => Math.max(max, el.z || 0), 0) + 1;
}

export function addTextLayer() {
  const page = currentPage();
  const dims = pageDims();
  const w = Math.round(dims.width * 0.5);
  const h = Math.round(dims.height * 0.25);
  const el = {
    id: uid('el'),
    x: Math.round((dims.width - w) / 2),
    y: Math.round((dims.height - h) / 2),
    w,
    h,
    z: nextZ(page),
    rotation: 0,
    ...defaultTextElement(),
  };
  page.elements.push(el);
  state.selectedLayerId = el.id;
  emit('layers:changed');
  emit('canvas:changed');
  emit('selection:changed');
  scheduleSave();
  return el;
}

export async function addImageLayer(file) {
  const { id, name } = await addImageAsset(file);
  const page = currentPage();
  const dims = pageDims();
  // calcula tamaño natural para no deformar
  const { w, h } = await imageNaturalSize(state.assetUrls.get(id));
  const maxW = dims.width * 0.6;
  const maxH = dims.height * 0.6;
  const scale = Math.min(maxW / w, maxH / h, 1);
  const ew = Math.round(w * scale);
  const eh = Math.round(h * scale);
  const el = {
    id: uid('el'),
    type: 'image',
    assetId: id,
    assetName: name,
    x: Math.round((dims.width - ew) / 2),
    y: Math.round((dims.height - eh) / 2),
    w: ew,
    h: eh,
    z: nextZ(page),
    rotation: 0,
    opacity: 1,
  };
  page.elements.push(el);
  state.selectedLayerId = el.id;
  emit('layers:changed');
  emit('canvas:changed');
  emit('selection:changed');
  scheduleSave();
  return el;
}

// Agrega una forma geométrica centrada en la página.
export function addShapeLayer() {
  const page = currentPage();
  const dims = pageDims();
  const size = Math.round(Math.min(dims.width, dims.height) * 0.35);
  const el = {
    id: uid('el'),
    x: Math.round((dims.width - size) / 2),
    y: Math.round((dims.height - size) / 2),
    w: size,
    h: size,
    z: nextZ(page),
    rotation: 0,
    ...defaultShapeElement(),
  };
  page.elements.push(el);
  state.selectedLayerId = el.id;
  emit('layers:changed');
  emit('canvas:changed');
  emit('selection:changed');
  scheduleSave();
  return el;
}

function imageNaturalSize(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 300, h: img.naturalHeight || 200 });
    img.onerror = () => resolve({ w: 300, h: 200 });
    img.src = url;
  });
}

// Duplica una capa (imagen o texto) conservando contenido y propiedades.
// La copia se coloca un poco desplazada, en el frente, y queda seleccionada.
export function duplicateLayer(id) {
  const page = currentPage();
  const src = page.elements.find((el) => el.id === id);
  if (!src) return null;
  const dims = pageDims();
  const step = 16;
  const copy = {
    ...src,
    id: uid('el'),
    z: nextZ(page),
    x: Math.max(0, Math.min(dims.width - src.w, src.x + step)),
    y: Math.max(0, Math.min(dims.height - src.h, src.y + step)),
  };
  page.elements.push(copy);
  state.selectedLayerId = copy.id;
  emit('layers:changed');
  emit('canvas:changed');
  emit('selection:changed');
  scheduleSave();
  return copy;
}

export function getLayer(id) {
  return currentPage().elements.find((el) => el.id === id) || null;
}

export function selectedLayer() {
  return state.selectedLayerId ? getLayer(state.selectedLayerId) : null;
}

export function selectLayer(id) {
  state.selectedLayerId = id;
  emit('selection:changed');
}

// Actualiza el texto sin reconstruir el lienzo: emite `layer:updated` para que
// canvas.js actualice en el lugar el nodo correspondiente (evita perder el foco
// mientras se escribe en el contenteditable o en el panel de propiedades).
export function setLayerText(id, text) {
  const el = getLayer(id);
  if (!el || el.text === text) return;
  el.text = text;
  emit('layer:updated', id);
  scheduleSave();
}

export function updateLayer(id, patch) {
  const el = getLayer(id);
  if (!el) return;
  Object.assign(el, patch);
  emit('layer:updated', id);
  scheduleSave();
}

export function deleteLayer(id) {
  const page = currentPage();
  const i = page.elements.findIndex((el) => el.id === id);
  if (i < 0) return;
  const [removed] = page.elements.splice(i, 1);
  if (removed.assetId) {
    // libera el blob si ningún otro elemento lo usa
    const stillUsed = state.current.pages.some((p) => p.elements.some((el) => el.assetId === removed.assetId));
    if (!stillUsed) {
      db.deleteAsset(removed.assetId);
      const url = state.assetUrls.get(removed.assetId);
      if (url) URL.revokeObjectURL(url);
      state.assetUrls.delete(removed.assetId);
    }
  }
  if (state.selectedLayerId === id) state.selectedLayerId = null;
  emit('layers:changed');
  emit('canvas:changed');
  emit('selection:changed');
  scheduleSave();
}

export function reorderLayer(id, delta) {
  const page = currentPage();
  const sorted = [...page.elements].sort((a, b) => a.z - b.z);
  const i = sorted.findIndex((el) => el.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= sorted.length) return;
  // intercambia posiciones z
  const a = sorted[i];
  const b = sorted[j];
  const tmp = a.z;
  a.z = b.z;
  b.z = tmp;
  emit('layers:changed');
  emit('canvas:changed');
  scheduleSave();
}

export function bringToFront(id) {
  const page = currentPage();
  const el = getLayer(id);
  if (!el) return;
  el.z = nextZ(page);
  emit('layers:changed');
  emit('canvas:changed');
  scheduleSave();
}

export function sendToBack(id) {
  const page = currentPage();
  const el = getLayer(id);
  if (!el) return;
  const min = page.elements.reduce((m, e) => Math.min(m, e.z), Infinity);
  el.z = min - 1;
  emit('layers:changed');
  emit('canvas:changed');
  scheduleSave();
}

export async function flushSave() {
  clearTimeout(saveTimer);
  await saveCurrent();
}
