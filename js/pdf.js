// pdf.js — exportación a PDF mediante el diálogo de impresión del navegador.
// Se construye un contenedor oculto (#printRoot) con una página por cada
// página del fanzine, dimensionado en píxeles, y se define @page con ese
// tamaño. Un stylesheet de impresión (styles.css) muestra sólo #printRoot.
//
// Alternativa considerada: vendorizar una librería PDF como asset local. Se
// descarta por ahora para mantener el proyecto sin dependencias.

import * as store from './store.js';
import { pageDimensions } from './constants.js';
import { commitEditing, buildShapeSvg, marginFitTransform, marginRectPx, marginActive } from './canvas.js';

export function exportToPdf() {
  if (!store.state.current) return;
  commitEditing(); // captura el texto del lienzo aún en edición
  const dims = pageDimensions(store.state.current.settings);

  let root = document.getElementById('printRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'printRoot';
    document.body.appendChild(root);
  }
  root.innerHTML = '';

  for (let i = 0; i < store.state.current.pages.length; i++) {
    root.appendChild(buildPrintPage(store.state.current.pages[i], dims, i + 1));
  }

  applyPageSize(dims.width, dims.height);

  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup);
    root.innerHTML = '';
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 60);
}

export function exportBookletToPdf() {
  if (!store.state.current) return;
  commitEditing();
  const dims = pageDimensions(store.state.current.settings);
  const pages = store.state.current.pages;

  let root = document.getElementById('printRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'printRoot';
    document.body.appendChild(root);
  }
  root.innerHTML = '';

  const n = pages.length;
  const padded = Math.ceil(n / 4) * 4;
  const pageAt = (num) => (num >= 1 && num <= n ? pages[num - 1] : null);
  const sheets = padded / 4;
  for (let k = 0; k < sheets; k++) {
    const fl = padded - 2 * k;
    const fr = 2 * k + 1;
    const bl = 2 * k + 2;
    const br = padded - 2 * k - 1;
    root.appendChild(buildPrintSheet(pageAt(fl), fl, pageAt(fr), fr, dims));
    root.appendChild(buildPrintSheet(pageAt(bl), bl, pageAt(br), br, dims));
  }

  applyPageSize(dims.width * 2, dims.height);

  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup);
    root.innerHTML = '';
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 60);
}

function buildPrintPage(page, dims, pageNumber) {
  const wrap = document.createElement('div');
  wrap.className = 'print-page';
  fillPrintPage(wrap, page, dims, pageNumber);
  return wrap;
}

function buildPrintSheet(leftPage, leftNum, rightPage, rightNum, dims) {
  const sheet = document.createElement('div');
  sheet.className = 'print-sheet';
  sheet.style.width = `${dims.width * 2}px`;
  sheet.style.height = `${dims.height}px`;
  sheet.appendChild(buildPrintHalf(leftPage, leftNum, dims));
  sheet.appendChild(buildPrintHalf(rightPage, rightNum, dims));
  return sheet;
}

function buildPrintHalf(page, pageNumber, dims) {
  const half = document.createElement('div');
  half.className = 'print-half';
  half.style.width = `${dims.width}px`;
  half.style.height = `${dims.height}px`;
  if (page) fillPrintPage(half, page, dims, pageNumber);
  return half;
}

function fillPrintPage(wrap, page, dims, pageNumber) {
  wrap.style.width = `${dims.width}px`;
  wrap.style.height = `${dims.height}px`;

  // Los márgenes de la hoja se reflejan igual que en el lienzo (WYSIWYG):
  // modo "superponer" recorta las capas a la caja de margen; modo "ajustar"
  // desplaza/encoge cada capa. La numeración queda fuera del recorte.
  const guides = store.state.current.settings.guides || {};
  const overlay = marginActive(guides) && (guides.mode || 'overlay') === 'overlay';
  let host = wrap;
  if (overlay) {
    const r = marginRectPx(guides);
    host = document.createElement('div');
    host.style.position = 'absolute';
    host.style.inset = '0';
    host.style.clipPath = `inset(${r.t}px ${r.r}px ${r.b}px ${r.l}px)`;
    wrap.appendChild(host);
  }

  const sorted = [...page.elements].sort((a, b) => a.z - b.z);
  for (const e of sorted) host.appendChild(buildPrintLayer(e, dims, guides));

  const corner = store.state.current.settings.numberCorner;
  if (corner && corner !== 'none') {
    const num = document.createElement('div');
    num.textContent = String(pageNumber);
    num.style.position = 'absolute';
    num.style.fontSize = '11px';
    num.style.color = '#555';
    num.style.fontFamily = 'system-ui, sans-serif';
    applyCorner(num, corner);
    wrap.appendChild(num);
  }
}

function buildPrintLayer(e, dims, guides) {
  const node = document.createElement('div');
  node.style.position = 'absolute';
  node.style.left = `${e.x}px`;
  node.style.top = `${e.y}px`;
  node.style.width = `${e.w}px`;
  node.style.height = `${e.h}px`;
  node.style.zIndex = String(e.z);
  const tf = marginFitTransform(e, dims, guides);
  if (tf) node.style.transform = tf;
  if (e.opacity != null && e.opacity !== 1) node.style.opacity = String(e.opacity);

  if (e.type === 'image') {
    const img = document.createElement('img');
    img.src = store.assetUrl(e.assetId) || '';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'fill';
    node.appendChild(img);
  } else if (e.type === 'shape') {
    node.appendChild(buildShapeSvg(e));
  } else {
    const c = document.createElement('div');
    c.textContent = e.text;
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.overflow = 'hidden';
    c.style.wordWrap = 'break-word';
    c.style.fontFamily = e.fontFamily;
    c.style.fontSize = `${e.fontSize}px`;
    c.style.textAlign = e.align;
    c.style.color = e.color;
    c.style.columnCount = String(e.columns);
    c.style.columnGap = '1.5em';
    c.style.lineHeight = String(e.lineHeight || 1.25);
    c.style.fontWeight = e.bold ? '700' : '400';
    c.style.fontStyle = e.italic ? 'italic' : 'normal';
    c.style.textDecoration = e.strike ? 'line-through' : 'none';
    if (e.outlineWidth > 0) {
      c.style.webkitTextStroke = `${e.outlineWidth}px ${e.outlineColor}`;
      c.style.paintOrder = 'stroke fill';
    }
    node.appendChild(c);
  }
  return node;
}

function applyCorner(node, corner) {
  const [v, h] = corner.split('-');
  if (v === 'top') node.style.top = '0';
  else node.style.bottom = '0';
  if (h === 'left') node.style.left = '0';
  else if (h === 'right') node.style.right = '0';
  else {
    node.style.left = '50%';
    node.style.transform = 'translateX(-50%)';
  }
  node.style.padding = '6px 10px';
}

function applyPageSize(width, height) {
  let style = document.getElementById('printPageSize');
  if (!style) {
    style = document.createElement('style');
    style.id = 'printPageSize';
    document.head.appendChild(style);
  }
  style.textContent = `@media print { @page { size: ${width}px ${height}px; margin: 0; } }`;
}
