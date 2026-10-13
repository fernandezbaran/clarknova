// fonts.js — lista de fuentes disponibles para el texto.
//
// Estrategias, en orden de preferencia:
//  1. Font Access API (`navigator.queryLocalFonts()`, solo Chromium): devuelve
//     TODAS las fuentes locales, pero requiere permiso del usuario; por eso se
//     pide desde un botón ("Usar fuentes del sistema") y no en el arranque.
//  2. Detección por medición: sondea una lista de familias comunes
//     (constants.js:FONT_CANDIDATES) y deduce cuáles están instaladas. Funciona
//     en Firefox/Safari (sin API) y como respaldo si el permiso se deniega. No
//     enumera fuentes arbitrarias, solo las candidatas.
//  3. Lista curada (constants.js:CURATED_FONTS), siempre como base.

import { CURATED_FONTS, FONT_CANDIDATES } from './constants.js';

function norm(name) {
  return String(name).toLowerCase().replace(/["']/g, '').trim();
}

const curated = CURATED_FONTS.slice();
const seen = new Set(curated.map((f) => norm(f.label || f.family)));
let locals = [];
let cachedList = curated.slice();

export function getFontList() {
  return cachedList;
}

// Agrega familias nuevas (sin duplicar) y recompone la lista: curadas primero,
// luego las locales ordenadas alfabéticamente. Devuelve cuántas se agregaron.
function addFamilies(names) {
  let added = 0;
  for (const name of names) {
    const key = norm(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    locals.push({ family: `"${name}"`, label: name, local: true });
    added++;
  }
  if (added) {
    locals.sort((a, b) => a.label.localeCompare(b.label, 'es'));
    cachedList = curated.concat(locals);
  }
  return added;
}

// ---- detección por medición -------------------------------------------
// Mide el ancho de un texto con la candidata frente al de cada familia
// genérica; si difiere, la candidata está instalada (y el navegador la ve).
function makeMeasurer() {
  const host = document.createElement('span');
  host.style.cssText =
    'position:absolute;left:-9999px;top:-9999px;white-space:nowrap;font-size:72px;visibility:hidden;';
  host.textContent = 'mmmmmmmmmmlliWWW';
  document.body.appendChild(host);

  const generics = ['monospace', 'sans-serif', 'serif'];
  const baseline = {};
  for (const g of generics) {
    host.style.fontFamily = g;
    baseline[g] = host.getBoundingClientRect().width;
  }

  return {
    has(name) {
      for (const g of generics) {
        host.style.fontFamily = `"${name}", ${g}`;
        if (Math.abs(host.getBoundingClientRect().width - baseline[g]) > 0.5) return true;
      }
      return false;
    },
    done() {
      host.remove();
    },
  };
}

export function detectInstalledFonts() {
  if (!document.body) return [];
  const m = makeMeasurer();
  const found = FONT_CANDIDATES.filter((name) => m.has(name));
  m.done();
  return found;
}

// ---- Font Access API ---------------------------------------------------
async function queryAllLocalFonts() {
  if (typeof window.queryLocalFonts !== 'function') return null;
  try {
    const available = await window.queryLocalFonts();
    const families = new Set();
    for (const f of available) if (f.family) families.add(f.family);
    return families.size ? [...families] : null;
  } catch {
    return null; // permiso denegado o error: caemos a la detección
  }
}

// Carga silenciosa al arrancar (sin permiso): agrega las fuentes comunes que
// detecte por medición. Devuelve cuántas se agregaron.
export function loadDetectedFonts() {
  return addFamilies(detectInstalledFonts());
}

// Botón "Usar fuentes del sistema": pide permiso a Chromium para listar TODAS
// las locales; si no hay API o se deniega, cae a la detección por medición.
export async function loadSystemFonts() {
  const all = await queryAllLocalFonts();
  if (all) return { via: 'api', added: addFamilies(all) };
  return { via: 'detect', added: addFamilies(detectInstalledFonts()) };
}

// Al entrar al sitio: intenta cargar TODAS las locales SIN prompt, pero solo
// funciona si el permiso 'local-fonts' YA estaba concedido (p. ej. en una PWA
// instalada, donde el permiso persiste). El navegador exige un gesto del
// usuario para PEDIR el permiso, así que no se puede abrir el diálogo solo.
// Si aún no está concedido, devuelve { via:'none' } y el botón sigue disponible.
export async function autoLoadSystemFonts() {
  if (typeof window.queryLocalFonts !== 'function') return { via: 'none', added: 0 };
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const status = await navigator.permissions.query({ name: 'local-fonts' });
      if (status.state !== 'granted') return { via: 'none', added: 0 };
    }
    const all = await queryAllLocalFonts();
    if (all) return { via: 'api', added: addFamilies(all) };
  } catch {
    // Sin activación del usuario o permiso denegado: seguimos igual.
  }
  return { via: 'none', added: 0 };
}
