// canvas.js — render del lienzo de la página y de las capas, más las
// interacciones de arrastre, redimensionado y rotación.

import * as store from './store.js';
import { pageDimensions, MM_TO_PX } from './constants.js';

const els = {};
let scale = 1;
let zoom = null; // null = ajustar a la ventana; número = factor manual (1 = 100%)
let editingLayerId = null;
let marginPreview = null; // guías vigentes durante el arrastre de un margen

export function initCanvas() {
  els.scroll = document.getElementById('canvasScroll');
  els.viewport = document.getElementById('pageViewport');
  els.canvas = document.getElementById('pageCanvas');
  els.root = document.getElementById('layerRoot');
  els.pageNumber = document.getElementById('pageNumber');
  els.pageFrame = document.getElementById('pageFrame');
  els.rulerH = document.getElementById('rulerH');
  els.rulerV = document.getElementById('rulerV');
  els.gridOverlay = document.getElementById('gridOverlay');
  els.marginGuides = document.getElementById('marginGuides');

  els.root.addEventListener('pointerdown', onLayerPointerDown);
  els.root.addEventListener('dblclick', onLayerDblClick);
  els.canvas.addEventListener('pointerdown', (e) => {
    if (e.target === els.canvas || e.target === els.root) {
      commitEditing();
      store.selectLayer(null);
    }
  });

  window.addEventListener('resize', () => render());
  els.scroll.addEventListener('wheel', onWheelZoom, { passive: false });

  els.zoomLevel = document.getElementById('btnZoomFit');
  document.getElementById('btnZoomIn').addEventListener('click', () => zoomBy(1.2));
  document.getElementById('btnZoomOut').addEventListener('click', () => zoomBy(1 / 1.2));
  els.zoomLevel.addEventListener('click', () => {
    zoom = null;
    render();
  });

  store.on('canvas:changed', render);
  store.on('selection:changed', updateSelection);
  store.on('layer:updated', updateNodeInPlace);
  // Antes de autoguardar, sincroniza el texto en curso al modelo sin interrumpir
  // la edición (no sale del contenteditable ni mueve el caret).
  store.onBeforeSave(captureEditing);
}

function updateNodeInPlace(id) {
  const node = els.root.querySelector(`.layer[data-id="${id}"]`);
  const el = store.getLayer(id);
  if (!node || !el) return;
  applyGeometry(node, el);
  if (el.type === 'text') {
    const c = node.querySelector('.content');
    if (!c) return;
    // Si la capa se está editando en el lienzo, no tocar su texto (perdería el
    // caret); sólo estilo y geometría.
    if (el.id !== editingLayerId) c.textContent = el.text;
    applyTextStyle(c, el);
  } else if (el.type === 'shape') {
    const c = node.querySelector('.shape-content');
    if (c) rebuildShape(c, el);
  }
}

export function updateSelection() {
  const id = store.state.selectedLayerId;
  els.root.querySelectorAll('.layer').forEach((node) => {
    const isSel = node.dataset.id === id;
    node.classList.toggle('selected', isSel);
    const existing = node.querySelector(':scope > .handles');
    if (existing) existing.remove();
    if (isSel && node.dataset.editing !== 'true') node.appendChild(buildHandles());
  });
}

// ---- render ------------------------------------------------------------
export function render() {
  if (!store.state.current) return;
  // Cualquier reconstrucción del lienzo destruye el contenteditable: captura
  // (y termina) la edición de texto en curso antes de sobrescribir el DOM.
  commitEditing();
  const dims = pageDimensions(store.state.current.settings);
  const { width, height } = dims;

  els.canvas.style.width = `${width}px`;
  els.canvas.style.height = `${height}px`;

  scale = zoom == null ? computeScale(width, height) : zoom;
  els.canvas.style.transform = `scale(${scale})`;
  els.viewport.style.width = `${width * scale}px`;
  els.viewport.style.height = `${height * scale}px`;
  updateZoomLabel();

  els.canvas.style.setProperty('--scale', String(scale));
  marginPreview = null;
  renderOverlays(dims);
  renderNumbering();
  renderLayers();
}

function computeScale(w, h) {
  // Mide el espacio disponible con el overflow oculto para que las barras de
  // desplazamiento transitorias (de un zoom previo) no alteren el "ajustar".
  const prev = els.scroll.style.overflow;
  els.scroll.style.overflow = 'hidden';
  const availW = els.scroll.clientWidth - 64;
  const availH = els.scroll.clientHeight - 64;
  els.scroll.style.overflow = prev;
  if (availW <= 0 || availH <= 0) return 1;
  return Math.min(availW / w, availH / h, 1);
}

function currentZoom() {
  return zoom == null ? scale : zoom;
}

function zoomBy(factor) {
  zoomTo(currentZoom() * factor);
}

// Cambia el zoom manteniendo (si hay `anchor`) el punto de la página que está
// bajo el cursor, para que la rueda acerque hacia donde apunta el ratón.
function zoomTo(next, anchor) {
  const clamped = Math.max(0.1, Math.min(4, next));
  if (Math.abs(clamped - currentZoom()) < 1e-4) return;
  zoom = clamped;
  render();
  if (!anchor) return;
  const sRect = els.scroll.getBoundingClientRect();
  const vRect = els.viewport.getBoundingClientRect();
  const vLeft = vRect.left - sRect.left + els.scroll.scrollLeft;
  const vTop = vRect.top - sRect.top + els.scroll.scrollTop;
  els.scroll.scrollLeft = vLeft + anchor.pageX * scale - (anchor.clientX - sRect.left);
  els.scroll.scrollTop = vTop + anchor.pageY * scale - (anchor.clientY - sRect.top);
}

function onWheelZoom(e) {
  e.preventDefault();
  const vRect = els.viewport.getBoundingClientRect();
  const anchor = {
    pageX: (e.clientX - vRect.left) / scale,
    pageY: (e.clientY - vRect.top) / scale,
    clientX: e.clientX,
    clientY: e.clientY,
  };
  zoomTo(currentZoom() * Math.exp(-e.deltaY * 0.0015), anchor);
}

function updateZoomLabel() {
  if (!els.zoomLevel) return;
  els.zoomLevel.textContent = `${Math.round(scale * 100)}%`;
  els.zoomLevel.classList.toggle('active', zoom == null);
}

function renderNumbering() {
  const corner = store.state.current.settings.numberCorner;
  const n = store.state.pageIndex + 1;
  els.pageNumber.dataset.corner = corner === 'none' ? 'bottom-right' : corner;
  els.pageNumber.textContent = corner === 'none' ? '' : String(n);
}

// Guías de referencia (reglas, márgenes y cuadrícula). No forman parte del
// documento: son ayudas visuales sobre la hoja. Las reglas y la cuadrícula no
// se exportan; el efecto de márgenes sí se refleja en el PDF (ver pdf.js).
function renderOverlays(dims) {
  const s = store.state.current.settings;
  const g = s.guides || {};
  els.canvas.style.setProperty('--gs', `${5 * MM_TO_PX}px`);
  els.canvas.style.setProperty('--gl', `${1 / scale}px`);
  els.gridOverlay.classList.toggle('on', !!g.grid);
  applyMarginClip(g);
  renderMarginLines(g);
  renderRulers(dims, g);
}

function renderMarginLines(g) {
  if (!els.marginGuides) return;
  const show = !!g.margins && !!g.ruler;
  els.marginGuides.classList.toggle('on', show);
  els.marginGuides.innerHTML = '';
  if (!show) return;
  const m = g.margin || {};
  const mm = (v) => (Number(v) || 0) * MM_TO_PX;
  const line = (cls, style, red) => {
    const d = document.createElement('div');
    d.className = `margin-line ${cls}${red ? ' red' : ''}`;
    Object.assign(d.style, style);
    els.marginGuides.appendChild(d);
  };
  line('v', { left: `${mm(m.left)}px` });
  line('v', { right: `${mm(m.right)}px` }, true);
  line('h', { top: `${mm(m.top)}px` });
  line('h', { bottom: `${mm(m.bottom)}px` }, true);
}

function renderRulers(dims, g) {
  if (!els.pageFrame) return;
  const on = !!g.ruler;
  els.pageFrame.classList.toggle('ruler-on', on);
  els.rulerH.innerHTML = '';
  els.rulerV.innerHTML = '';
  if (!on) return;
  const unit = MM_TO_PX * scale; // píxeles de pantalla por mm
  const pageWmm = dims.width / MM_TO_PX;
  const pageHmm = dims.height / MM_TO_PX;
  // Las reglas se posicionan en absoluto (fuera de la hoja) para que activarlas
  // o desactivarlas no altere el centrado del lienzo: fijamos su longitud.
  els.rulerH.style.width = `${dims.width * scale}px`;
  els.rulerV.style.height = `${dims.height * scale}px`;
  drawRuler(els.rulerH, 'h', pageWmm, unit);
  drawRuler(els.rulerV, 'v', pageHmm, unit);
  if (g.margins) {
    addMarginHandles(els.rulerH, 'h', pageWmm, unit, g);
    addMarginHandles(els.rulerV, 'v', pageHmm, unit, g);
  }
}

function drawRuler(el, axis, lengthMm, unit) {
  const minor = 5 * unit;
  const major = 10 * unit;
  const ink = 'rgba(154,154,174,.7)';
  const inkMajor = 'rgba(236,236,241,.9)';
  const dir = axis === 'h' ? 'to right' : 'to bottom';
  el.style.backgroundImage =
    `repeating-linear-gradient(${dir}, ${inkMajor} 0 1px, transparent 1px ${major}px),` +
    `repeating-linear-gradient(${dir}, ${ink} 0 1px, transparent 1px ${minor}px)`;
  el.style.backgroundRepeat = axis === 'h' ? 'repeat-x, repeat-x' : 'repeat-y, repeat-y';
  if (axis === 'h') {
    el.style.backgroundSize = 'auto 13px, auto 7px';
    el.style.backgroundPosition = '0 100%, 0 100%';
  } else {
    el.style.backgroundSize = '13px auto, 7px auto';
    el.style.backgroundPosition = '100% 0, 100% 0';
  }
  const step = labelStep(unit);
  for (let mm = 0; mm <= lengthMm + 0.01; mm += step) {
    const span = document.createElement('span');
    span.className = 'ruler-num';
    const pos = mm * unit;
    if (axis === 'h') span.style.left = `${pos}px`;
    else span.style.top = `${pos}px`;
    const cm = mm / 10;
    span.textContent = Number.isInteger(cm) ? String(cm) : cm.toFixed(1);
    el.appendChild(span);
  }
}

// Elige el intervalo de etiquetas (en mm) para que no se solapen a ningún zoom.
function labelStep(unit) {
  for (const s of [10, 20, 50, 100]) if (s * unit >= 24) return s;
  return 200;
}

function addMarginHandles(el, axis, lengthMm, unit, g) {
  const m = g.margin || {};
  const items = axis === 'h'
    ? [{ side: 'left', mm: Number(m.left) || 0 }, { side: 'right', mm: Number(m.right) || 0 }]
    : [{ side: 'top', mm: Number(m.top) || 0 }, { side: 'bottom', mm: Number(m.bottom) || 0 }];
  for (const it of items) {
    const fromStart = it.side === 'left' || it.side === 'top';
    const pos = fromStart ? it.mm : lengthMm - it.mm;
    const red = it.side === 'right' || it.side === 'bottom';
    const h = document.createElement('div');
    h.className = `margin-handle on-ruler-${axis}${red ? ' red' : ''}`;
    if (axis === 'h') h.style.left = `${pos * unit}px`;
    else h.style.top = `${pos * unit}px`;
    h.dataset.axis = axis;
    h.dataset.side = it.side;
    h.title = 'Arrastrar margen';
    h.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 1 L11 6 L1 11 Z"/></svg>';
    h.addEventListener('pointerdown', onMarginHandleDown);
    el.appendChild(h);
  }
}

function onMarginHandleDown(e) {
  e.preventDefault();
  e.stopPropagation();
  const handle = e.currentTarget;
  const axis = handle.dataset.axis;
  const side = handle.dataset.side;
  const s = store.state.current.settings;
  const g = s.guides || {};
  const dims = pageDimensions(s);
  const lengthMm = (axis === 'h' ? dims.width : dims.height) / MM_TO_PX;
  const unit = MM_TO_PX * scale;
  const ruler = axis === 'h' ? els.rulerH : els.rulerV;
  const rect = ruler.getBoundingClientRect();
  const origin = axis === 'h' ? rect.left : rect.top;
  const MIN = 5; // separación mínima entre márgenes (mm)
  const margin = { ...(g.margin || {}) };
  const opp = opposite(side);
  const limit = () => lengthMm - (Number(margin[opp]) || 0) - MIN;

  const move = (ev) => {
    const pos = ((axis === 'h' ? ev.clientX : ev.clientY) - origin) / unit;
    const value = side === 'left' || side === 'top' ? pos : lengthMm - pos;
    margin[side] = Math.round(Math.max(0, Math.min(limit(), value)) * 10) / 10;
    applyMarginPreview(dims, { ...g, margin }, unit);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    marginPreview = null;
    store.setSettings({ guides: { ...g, margin } });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function opposite(side) {
  return { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[side];
}

// Durante el arrastre: reaplica el efecto de márgenes y reposiciona los
// tiradores sin reconstruir las reglas (mantiene la interacción fluida).
function applyMarginPreview(dims, g, unit) {
  marginPreview = g;
  applyMarginClip(g);
  renderMarginLines(g);
  if (els.root) {
    for (const node of els.root.querySelectorAll('.layer')) {
      const el = store.getLayer(node.dataset.id);
      if (el) node.style.transform = marginFitTransform(el, dims, g);
    }
  }
  const m = g.margin || {};
  const pageWmm = dims.width / MM_TO_PX;
  const pageHmm = dims.height / MM_TO_PX;
  for (const h of els.rulerH.querySelectorAll('.margin-handle')) {
    const pos = h.dataset.side === 'left' ? Number(m.left) || 0 : pageWmm - (Number(m.right) || 0);
    h.style.left = `${pos * unit}px`;
  }
  for (const h of els.rulerV.querySelectorAll('.margin-handle')) {
    const pos = h.dataset.side === 'top' ? Number(m.top) || 0 : pageHmm - (Number(m.bottom) || 0);
    h.style.top = `${pos * unit}px`;
  }
}

function renderLayers() {
  const page = store.currentPage();
  els.root.innerHTML = '';
  const sorted = [...page.elements].sort((a, b) => a.z - b.z);
  for (const el of sorted) els.root.appendChild(buildLayerEl(el));
}

function buildLayerEl(el) {
  const node = document.createElement('div');
  node.className = `layer layer-${el.type}`;
  node.dataset.id = el.id;
  applyGeometry(node, el);
  if (el.id === store.state.selectedLayerId) node.classList.add('selected');

  if (el.type === 'image') {
    const img = document.createElement('img');
    const url = store.assetUrl(el.assetId);
    if (url) img.src = url;
    img.alt = el.assetName || '';
    img.draggable = false;
    node.appendChild(img);
  } else if (el.type === 'shape') {
    const content = document.createElement('div');
    content.className = 'shape-content';
    rebuildShape(content, el);
    node.appendChild(content);
  } else {
    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = el.text;
    applyTextStyle(content, el);
    if (el.id === editingLayerId) {
      content.contentEditable = 'true';
      node.dataset.editing = 'true';
    }
    node.appendChild(content);
  }

  if (el.id === store.state.selectedLayerId) {
    node.appendChild(buildHandles());
  }
  return node;
}

// Guías de margen vigentes (durante el arrastre se usan las de previsualización).
function currentGuides() {
  return marginPreview || (store.state.current.settings.guides || {});
}

export function marginRectPx(g) {
  const m = g.margin || {};
  const px = (v) => (Number(v) || 0) * MM_TO_PX;
  return { l: px(m.left), t: px(m.top), r: px(m.right), b: px(m.bottom) };
}

export function marginActive(g) {
  return !!(g.margins && g.ruler);
}

// Modo "Superponer": recorta todo lo que cae fuera de los márgenes (queda en
// blanco). Sólo visual, no toca el modelo. root no cubre la numeración.
function applyMarginClip(g) {
  if (!els.root) return;
  const on = marginActive(g) && (g.mode || 'overlay') === 'overlay';
  if (!on) { els.root.style.clipPath = ''; return; }
  const r = marginRectPx(g);
  els.root.style.clipPath = `inset(${r.t}px ${r.r}px ${r.b}px ${r.l}px)`;
}

// Modo "Ajustar": desplaza cada capa para meterla en los márgenes y, si no
// cabe (colisiona con el margen opuesto), la encoge proporcionalmente.
// Devuelve la transformación visual (no modifica el documento).
export function marginFitTransform(el, dims, g) {
  const base = el.rotation ? `rotate(${el.rotation}deg)` : '';
  if (!(marginActive(g) && (g.mode || 'overlay') === 'fit')) return base;
  const r = marginRectPx(g);
  const Wa = Math.max(1, dims.width - r.l - r.r);
  const Ha = Math.max(1, dims.height - r.t - r.b);
  const rad = (el.rotation || 0) * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const hw = (el.w * cos + el.h * sin) / 2;
  const hh = (el.w * sin + el.h * cos) / 2;
  let sc = 1;
  if (2 * hw > Wa) sc = Math.min(sc, Wa / (2 * hw));
  if (2 * hh > Ha) sc = Math.min(sc, Ha / (2 * hh));
  sc = Math.max(0.01, sc);
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const halfW = hw * sc;
  const halfH = hh * sc;
  const loX = r.l + halfW, hiX = dims.width - r.r - halfW;
  const loY = r.t + halfH, hiY = dims.height - r.b - halfH;
  const ncx = hiX >= loX ? Math.min(Math.max(cx, loX), hiX) : (loX + hiX) / 2;
  const ncy = hiY >= loY ? Math.min(Math.max(cy, loY), hiY) : (loY + hiY) / 2;
  const tx = ncx - cx, ty = ncy - cy;
  const parts = [];
  if (Math.abs(tx) > 0.01 || Math.abs(ty) > 0.01) parts.push(`translate(${tx}px, ${ty}px)`);
  if (base) parts.push(base);
  if (Math.abs(sc - 1) > 1e-4) parts.push(`scale(${sc})`);
  return parts.join(' ');
}

export function applyGeometry(node, el) {
  node.style.left = `${el.x}px`;
  node.style.top = `${el.y}px`;
  node.style.width = `${el.w}px`;
  node.style.height = `${el.h}px`;
  node.style.zIndex = String(el.z);
  const dims = pageDimensions(store.state.current.settings);
  node.style.transform = marginFitTransform(el, dims, currentGuides());
  node.style.opacity = el.opacity == null ? '' : String(el.opacity);
}

export function applyTextStyle(content, el) {
  const s = content.style;
  s.fontFamily = el.fontFamily;
  s.fontSize = `${el.fontSize}px`;
  s.textAlign = el.align;
  s.color = el.color;
  s.columnCount = String(el.columns);
  s.columnGap = '1.5em';
  s.lineHeight = String(el.lineHeight || 1.25);
  s.fontWeight = el.bold ? '700' : '400';
  s.fontStyle = el.italic ? 'italic' : 'normal';
  s.textDecoration = el.strike ? 'line-through' : 'none';
  if (el.outlineWidth > 0) {
    s.webkitTextStroke = `${el.outlineWidth}px ${el.outlineColor}`;
    s.textStroke = `${el.outlineWidth}px ${el.outlineColor}`;
    s.paintOrder = 'stroke fill';
  } else {
    s.webkitTextStroke = '';
    s.textStroke = '';
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Construye el SVG de una forma con coordenadas en px de página (1:1 con el
// modelo), de modo que el trazo escale con el zoom igual que el resto.
export function buildShapeSvg(el) {
  const w = el.w;
  const h = el.h;
  const sw = Math.max(0, Number(el.strokeWidth) || 0);
  const half = sw / 2;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'shape-svg');
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  let shape;
  if (el.shape === 'circle' || el.shape === 'ellipse') {
    shape = document.createElementNS(SVG_NS, 'ellipse');
    shape.setAttribute('cx', String(w / 2));
    shape.setAttribute('cy', String(h / 2));
    shape.setAttribute('rx', String(Math.max(0, (w - sw) / 2)));
    shape.setAttribute('ry', String(Math.max(0, (h - sw) / 2)));
  } else if (el.shape === 'triangle') {
    shape = document.createElementNS(SVG_NS, 'polygon');
    shape.setAttribute('points', `${w / 2},${half} ${w - half},${h - half} ${half},${h - half}`);
  } else {
    shape = document.createElementNS(SVG_NS, 'rect');
    shape.setAttribute('x', String(half));
    shape.setAttribute('y', String(half));
    shape.setAttribute('width', String(Math.max(0, w - sw)));
    shape.setAttribute('height', String(Math.max(0, h - sw)));
  }
  shape.setAttribute('fill', el.fill || 'none');
  if (sw > 0) {
    shape.setAttribute('stroke', el.stroke || 'none');
    shape.setAttribute('stroke-width', String(sw));
    shape.setAttribute('stroke-linejoin', 'round');
  } else {
    shape.setAttribute('stroke', 'none');
  }
  svg.appendChild(shape);
  return svg;
}

function rebuildShape(container, el) {
  container.innerHTML = '';
  container.appendChild(buildShapeSvg(el));
}

function buildHandles() {
  const wrap = document.createElement('div');
  wrap.className = 'handles';
  for (const dir of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const h = document.createElement('div');
    h.className = 'handle';
    h.dataset.dir = dir;
    h.dataset.role = 'resize';
    wrap.appendChild(h);
  }
  const line = document.createElement('div');
  line.className = 'rotate-line';
  wrap.appendChild(line);
  const rot = document.createElement('div');
  rot.className = 'rotate-handle';
  rot.dataset.role = 'rotate';
  rot.textContent = '↻';
  wrap.appendChild(rot);
  return wrap;
}

// ---- coordenadas -------------------------------------------------------
function pointerToPage(e) {
  const rect = els.canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
}

function rotateVec(x, y, deg) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
}

// ---- edición de texto --------------------------------------------------
function onLayerDblClick(e) {
  const node = e.target.closest('.layer');
  if (!node) return;
  const el = store.getLayer(node.dataset.id);
  if (!el || el.type !== 'text') return;
  startEditing(el.id, node);
}

function startEditing(id, node) {
  editingLayerId = id;
  const content = node.querySelector('.content');
  if (!content) return;
  node.dataset.editing = 'true';
  content.contentEditable = 'true';
  content.focus();
  const range = document.createRange();
  range.selectNodeContents(content);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// Sincroniza el texto del contenteditable hacia el modelo. No abandona el modo
// de edición (no pierde el foco/caret): se usa en el autoguardado.
function captureEditing() {
  if (!editingLayerId) return;
  const id = editingLayerId;
  const node = els.root.querySelector(`.layer[data-id="${id}"]`);
  if (!node) return;
  const content = node.querySelector('.content');
  if (content) store.setLayerText(id, content.textContent);
}

// Captura el texto y abandona el modo de edición directa. Se llama al hacer
// clic fuera, al guardar y al reconstruir el lienzo (navegar, reordenar, etc.).
export function commitEditing() {
  captureEditing();
  if (!editingLayerId) return;
  const node = els.root.querySelector(`.layer[data-id="${editingLayerId}"]`);
  editingLayerId = null;
  if (node) {
    const content = node.querySelector('.content');
    if (content) content.contentEditable = 'false';
    node.dataset.editing = 'false';
  }
}

// ---- interacciones -----------------------------------------------------
function onLayerPointerDown(e) {
  if (editingLayerId) {
    // permite seleccionar texto / colocar cursor dentro del cuadro en edición
    if (e.target.closest('.layer')?.dataset.id === editingLayerId) return;
    commitEditing();
  }

  const handle = e.target.closest('.handle, .rotate-handle');
  const node = e.target.closest('.layer');
  if (!node) return;
  const el = store.getLayer(node.dataset.id);
  if (!el) return;

  if (handle) {
    e.preventDefault();
    const role = handle.dataset.role;
    if (role === 'rotate') startRotate(e, el, node);
    else startResize(e, el, node, handle.dataset.dir);
    return;
  }

  // selección + arrastre
  store.selectLayer(el.id);
  startMove(e, el, node);
}

function startMove(e, el, node) {
  e.preventDefault();
  const start = pointerToPage(e);
  const orig = { x: el.x, y: el.y };
  const move = (ev) => {
    const p = pointerToPage(ev);
    el.x = Math.round(orig.x + (p.x - start.x));
    el.y = Math.round(orig.y + (p.y - start.y));
    applyGeometry(node, el);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    store.updateLayer(el.id, { x: el.x, y: el.y });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function startResize(e, el, node, dir) {
  e.preventDefault();
  const start = pointerToPage(e);
  const o = { x: el.x, y: el.y, w: el.w, h: el.h, r: el.rotation || 0 };
  const center0 = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
  const sx = dir.includes('w') ? 1 : dir.includes('e') ? -1 : 0;
  const sy = dir.includes('n') ? 1 : dir.includes('s') ? -1 : 0;
  const MIN = 24;

  const move = (ev) => {
    const p = pointerToPage(ev);
    const gdx = p.x - start.x;
    const gdy = p.y - start.y;
    const l = rotateVec(gdx, gdy, -o.r);
    let w = sx !== 0 ? Math.max(MIN, o.w - sx * l.x) : o.w;
    let h = sy !== 0 ? Math.max(MIN, o.h - sy * l.y) : o.h;
    // punto de anclaje (esquina/borde opuesto) fijo
    const anchorLocal = rotateVec((sx * o.w) / 2, (sy * o.h) / 2, o.r);
    const anchor = { x: center0.x + anchorLocal.x, y: center0.y + anchorLocal.y };
    const newCenterLocal = rotateVec((-sx * w) / 2, (-sy * h) / 2, o.r);
    const cx = anchor.x + newCenterLocal.x;
    const cy = anchor.y + newCenterLocal.y;
    el.w = Math.round(w);
    el.h = Math.round(h);
    el.x = Math.round(cx - w / 2);
    el.y = Math.round(cy - h / 2);
    applyGeometry(node, el);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    store.updateLayer(el.id, { x: el.x, y: el.y, w: el.w, h: el.h });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function startRotate(e, el, node) {
  e.preventDefault();
  const center = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  const p = pointerToPage(e);
  const startAngle = Math.atan2(p.y - center.y, p.x - center.x);
  const startRot = el.rotation || 0;

  const move = (ev) => {
    const q = pointerToPage(ev);
    const angle = Math.atan2(q.y - center.y, q.x - center.x);
    let deg = startRot + ((angle - startAngle) * 180) / Math.PI;
    deg = Math.round(deg);
    el.rotation = ((deg % 360) + 360) % 360;
    applyGeometry(node, el);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    store.updateLayer(el.id, { rotation: el.rotation });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
