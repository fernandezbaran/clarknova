// io.js — exportación/importación de fanzines como archivo portable.
// Formato: un único archivo JSON con las imágenes embebidas como data URLs.
// Un archivo puede contener uno o varios fanzines (campo `fanzines`), lo que
// sirve tanto para "Exportar" uno como para "Exportar todos".
//
//     { app: "fanzine-maker", format: 1, exportedAt, fanzines: [ {name,
//       createdAt, updatedAt, settings, pages, assets:[{id,name,type,data}]} ] }
//
// Al importar se regeneran todos los ids (fanzine, páginas, capas y assets)
// para no pisar fanzines existentes: importar equivale a "agregar una copia".

import * as db from './db.js';
import { uid, saveCurrent } from './store.js';
import { defaultSettings } from './constants.js';

const FORMAT = 1;
const APP_TAG = 'fanzine-maker';

// ---- helpers -----------------------------------------------------------
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataURL) {
  const [meta, b64] = String(dataURL).split(',');
  const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64 || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function sanitize(name) {
  return (name || 'fanzine').trim().replace(/[^\p{L}\p{N}\-_ ]/gu, '').replace(/\s+/g, '_').slice(0, 60) || 'fanzine';
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- export ------------------------------------------------------------
async function serializeFanzine(doc) {
  const assetIds = new Set();
  for (const page of doc.pages) for (const el of page.elements) if (el.assetId) assetIds.add(el.assetId);

  const assets = [];
  for (const id of assetIds) {
    const asset = await db.getAsset(id);
    if (!asset) continue;
    assets.push({ id: asset.id, name: asset.name, type: asset.type, data: await blobToDataURL(asset.blob) });
  }

  return {
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    settings: doc.settings,
    pages: doc.pages,
    assets,
  };
}

export async function exportFanzine(id) {
  await saveCurrent(); // vuelca cambios pendientes del fanzine abierto
  const doc = await db.getFanzine(id);
  if (!doc) throw new Error('No se encontró el fanzine.');
  const payload = {
    app: APP_TAG,
    format: FORMAT,
    exportedAt: Date.now(),
    fanzines: [await serializeFanzine(doc)],
  };
  download(`${sanitize(doc.name)}.fanzine.json`, JSON.stringify(payload));
}

export async function exportAllFanzines() {
  await saveCurrent(); // vuelca cambios pendientes del fanzine abierto
  const docs = await db.getAllFanzines();
  if (!docs.length) throw new Error('No hay fanzines para exportar.');
  const fanzines = [];
  for (const doc of docs) fanzines.push(await serializeFanzine(doc));
  const payload = { app: APP_TAG, format: FORMAT, exportedAt: Date.now(), fanzines };
  download(`fanzines_${new Date().toISOString().slice(0, 10)}.fanzine.json`, JSON.stringify(payload));
  return fanzines.length;
}

// ---- import ------------------------------------------------------------
async function importOne(src) {
  // Reasigna ids de assets y construye el mapa antiguo→nuevo.
  const assetMap = new Map();
  for (const a of src.assets || []) {
    if (!a || !a.data) continue;
    const newId = uid('as');
    assetMap.set(a.id, newId);
    try {
      await db.putAsset({ id: newId, name: a.name || 'imagen', type: a.type || 'image/png', blob: dataURLToBlob(a.data) });
    } catch {
      assetMap.delete(a.id);
    }
  }

  const pages = (src.pages && src.pages.length ? src.pages : [{ elements: [] }]).map((page) => ({
    id: uid('pg'),
    elements: (page.elements || []).map((el) => {
      const copy = { ...el, id: uid('el') };
      if (copy.assetId) {
        if (assetMap.has(copy.assetId)) copy.assetId = assetMap.get(copy.assetId);
        else delete copy.assetId; // asset ausente: dejamos la capa sin imagen
      }
      return copy;
    }),
  }));

  const doc = {
    id: uid('fz'),
    name: src.name || 'Fanzine importado',
    createdAt: src.createdAt || Date.now(),
    updatedAt: Date.now(),
    settings: { ...defaultSettings(), ...(src.settings || {}) },
    pages,
  };
  await db.putFanzine(doc);
}

export async function importFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }

  let list;
  if (Array.isArray(data.fanzines)) list = data.fanzines;
  else if (data.pages && data.settings) list = [data]; // documento suelto
  else throw new Error('Formato de fanzine no reconocido.');

  let count = 0;
  for (const item of list) {
    if (item && (item.pages || item.settings)) {
      await importOne(item);
      count++;
    }
  }
  if (!count) throw new Error('El archivo no contiene fanzines.');
  return count;
}
