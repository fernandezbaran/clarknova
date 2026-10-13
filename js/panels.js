// panels.js — barras laterales: lista de páginas, lista de capas, editor de
// propiedades de la capa seleccionada, modal de fanzines y toasts.

import * as store from './store.js';
import * as io from './io.js';
import { getFontList, loadSystemFonts } from './fonts.js';
import { ALIGNMENTS, SHAPES, pageDimensions } from './constants.js';

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
};

// ---- ciclo -------------------------------------------------------------
// Evita que el panel se reconstruya mientras el propio usuario lo edita (lo
// que haría perder el foco del input o romper el arrastre de un slider).
let guardActive = false;
function guard() {
  guardActive = true;
  setTimeout(() => {
    guardActive = false;
  }, 0);
}

export function initPanels() {
  store.on('selection:changed', () => {
    renderLayerList();
    renderLayerProps();
  });
  store.on('layers:changed', renderLayerList);
  store.on('pages:changed', () => {
    renderPageList();
    renderLayerList();
    renderLayerProps();
  });
  store.on('layer:updated', () => {
    if (!guardActive) renderLayerProps();
  });
  store.on('history:changed', syncHistory);
  initSidebarResizers();
}

// ---- divisores arrastrables de la barra derecha -------------------------
// Reasignan la altura entre la lista de capas, los botones de objetos y las
// variables de edición. Cada divisor tiene un tirador central y se arrastra
// arriba/abajo (en móvil se ocultan, porque la barra cambia de disposición).
function initSidebarResizers() {
  const sidebar = document.querySelector('.sidebar-right');
  if (!sidebar) return;
  const list = document.getElementById('layerList');
  const actions = document.getElementById('sidebarActions');
  const props = document.getElementById('layerProps');
  const head = sidebar.querySelector('.sidebar-head');
  const handles = [...sidebar.querySelectorAll('.sidebar-resizer')];
  if (!list || !actions || !props || !head || !handles.length) return;

  const MIN_LIST = 60;
  const MIN_PROPS = 110;
  const actionsMin = Math.max(44, actions.scrollHeight);
  const resH = handles.reduce((sum, h) => sum + h.getBoundingClientRect().height, 0);

  handles.forEach((handle) => {
    const isList = handle.dataset.resize === 'layerList';
    const target = isList ? list : actions;
    const other = isList ? actions : list;
    const min = isList ? MIN_LIST : actionsMin;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = target.getBoundingClientRect().height;
      const maxH = Math.max(
        min,
        sidebar.getBoundingClientRect().height -
          head.getBoundingClientRect().height -
          other.getBoundingClientRect().height -
          resH -
          MIN_PROPS
      );
      handle.classList.add('dragging');
      try { handle.setPointerCapture(e.pointerId); } catch { /* puntero sintético */ }
      document.body.style.userSelect = 'none';

      const onMove = (ev) => {
        const h = Math.max(min, Math.min(startH + (ev.clientY - startY), maxH));
        target.style.flex = '0 0 auto';
        target.style.height = `${h}px`;
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        document.body.style.userSelect = '';
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  });
}

// ---- toast -------------------------------------------------------------
let toastTimer = null;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

// ---- thumbnails --------------------------------------------------------
function buildThumb(page) {
  const dims = pageDimensions(store.state.current.settings);
  const maxH = 48;
  const th = maxH;
  const tw = Math.max(20, Math.round((dims.width / dims.height) * maxH));
  const thumb = el('div', { class: 'thumb' });
  thumb.style.width = `${tw}px`;
  thumb.style.height = `${th}px`;
  thumb.style.position = 'relative';
  thumb.style.overflow = 'hidden';
  const sx = tw / dims.width;
  const sy = th / dims.height;
  for (const e of page.elements) {
    const box = el('div');
    box.style.position = 'absolute';
    box.style.left = `${e.x * sx}px`;
    box.style.top = `${e.y * sy}px`;
    box.style.width = `${Math.max(1, e.w * sx)}px`;
    box.style.height = `${Math.max(1, e.h * sy)}px`;
    box.style.background = e.type === 'text' ? '#bbb' : e.type === 'shape' ? (e.fill || '#4d7cff') : '#8aa0c8';
    thumb.appendChild(box);
  }
  return thumb;
}

// ---- lista de páginas --------------------------------------------------
export function renderPageList() {
  const list = document.getElementById('pageList');
  const badge = document.getElementById('pageCount');
  if (!store.state.current) return;
  const pages = store.state.current.pages;
  badge.textContent = String(pages.length);
  list.innerHTML = '';
  pages.forEach((page, i) => {
    const li = el('li', { class: i === store.state.pageIndex ? 'active' : '' }, [
      buildThumb(page),
      el('div', {}, [
        el('div', { class: 'li-label' }, `Página ${i + 1}`),
        el('div', { class: 'li-sub' }, `${page.elements.length} capa${page.elements.length === 1 ? '' : 's'}`),
      ]),
      el('div', { class: 'layer-cmds' }, [
        el('button', { title: 'Duplicar página', onclick: (e) => stop(e, () => store.duplicatePage(i)) }, '⧉'),
        el('button', { title: 'Subir página', disabled: i === 0, onclick: (e) => stop(e, () => store.movePage(i, -1)) }, '▲'),
        el('button', { title: 'Bajar página', disabled: i === pages.length - 1, onclick: (e) => stop(e, () => store.movePage(i, 1)) }, '▼'),
      ]),
    ]);
    li.addEventListener('click', () => store.gotoPage(i));
    list.appendChild(li);
  });
}

// ---- lista de capas ----------------------------------------------------
export function renderLayerList() {
  const list = document.getElementById('layerList');
  const badge = document.getElementById('layerCount');
  if (!store.state.current) return;
  const page = store.currentPage();
  badge.textContent = String(page.elements.length);
  list.innerHTML = '';
  const sorted = [...page.elements].sort((a, b) => b.z - a.z);
  for (const lyr of sorted) {
    const isText = lyr.type === 'text';
    const isShape = lyr.type === 'shape';
    const label = isText
      ? (lyr.text || 'Texto').slice(0, 28)
      : isShape
        ? (SHAPES.find((s) => s.value === lyr.shape) || {}).label || 'Forma'
        : lyr.assetName || 'Imagen';
    const li = el('li', { class: lyr.id === store.state.selectedLayerId ? 'active' : '' }, [
      el('span', { class: 'li-icon' }, isText ? 'T' : isShape ? '◆' : '▣'),
      el('span', { class: 'li-label' }, label),
      el('div', { class: 'layer-cmds' }, [
        el('button', { title: 'Subir', onclick: (e) => stop(e, () => store.reorderLayer(lyr.id, 1)) }, '▲'),
        el('button', { title: 'Bajar', onclick: (e) => stop(e, () => store.reorderLayer(lyr.id, -1)) }, '▼'),
        el('button', { title: 'Traer al frente', onclick: (e) => stop(e, () => store.bringToFront(lyr.id)) }, '⤒'),
        el('button', { title: 'Enviar al fondo', onclick: (e) => stop(e, () => store.sendToBack(lyr.id)) }, '⤓'),
        el('button', { title: 'Duplicar capa', onclick: (e) => stop(e, () => store.duplicateLayer(lyr.id)) }, '⧉'),
        el('button', { title: 'Borrar capa', onclick: (e) => stop(e, () => store.deleteLayer(lyr.id)) }, '✕'),
      ]),
    ]);
    li.addEventListener('click', () => store.selectLayer(lyr.id));
    list.appendChild(li);
  }
}

function stop(e, fn) {
  e.stopPropagation();
  fn();
}

// ---- editor de propiedades --------------------------------------------
export function renderLayerProps() {
  const host = document.getElementById('layerProps');
  host.innerHTML = '';
  const layer = store.selectedLayer();
  if (!layer) {
    host.appendChild(el('p', { class: 'empty' }, 'Ninguna capa seleccionada.'));
    return;
  }
  const set = (patch) => {
    guard();
    store.updateLayer(layer.id, patch);
  };

  // geometría común
  host.appendChild(group('Posición y tamaño', [
    row([
      numField('X', layer.x, (v) => set({ x: v })),
      numField('Y', layer.y, (v) => set({ y: v })),
    ]),
    row([
      numField('Ancho', layer.w, (v) => set({ w: Math.max(24, v) })),
      numField('Alto', layer.h, (v) => set({ h: Math.max(24, v) })),
    ]),
    rangeField('Rotación', layer.rotation || 0, 0, 360, 1, (v) => set({ rotation: v })),
  ]));

  if (layer.type === 'text') renderTextProps(host, layer, set);
  else if (layer.type === 'shape') renderShapeProps(host, layer, set);
  else renderImageProps(host, layer);

  host.appendChild(group('Apariencia', [
    rangeField('Opacidad', layer.opacity == null ? 1 : layer.opacity, 0, 1, 0.05, (v) => set({ opacity: v })),
  ]));

  host.appendChild(group('Orden', [
    row([
      el('button', { class: 'btn', onclick: () => store.bringToFront(layer.id) }, 'Al frente'),
      el('button', { class: 'btn', onclick: () => store.sendToBack(layer.id) }, 'Al fondo'),
    ]),
  ]));

  host.appendChild(group('Capa', [
    row([
      el('button', { class: 'btn', onclick: () => store.duplicateLayer(layer.id) }, 'Duplicar'),
    ]),
  ]));
}

function renderTextProps(host, layer, set) {
  const textarea = el('textarea', { value: layer.text });
  textarea.addEventListener('input', () => {
    guard();
    store.setLayerText(layer.id, textarea.value);
  });

  const fontSelect = el(
    'select',
    {},
    getFontList().map((f) =>
      el('option', { value: f.family, selected: f.family === layer.fontFamily }, f.label)
    )
  );
  fontSelect.addEventListener('change', () => set({ fontFamily: fontSelect.value }));

  host.appendChild(group('Texto', [textarea]));
  host.appendChild(group('Tipografía', [
    fontSelect,
    el('button', { class: 'btn', onclick: async () => {
      const res = await loadSystemFonts();
      if (res.via === 'api') toast(res.added ? `Fuentes del sistema: ${res.added} nuevas` : 'No hay fuentes nuevas');
      else toast(res.added ? `Detectadas ${res.added} fuentes instaladas` : 'No se detectaron fuentes nuevas');
      renderLayerProps();
    } }, 'Usar fuentes del sistema'),
    toggleField([
      { key: 'bold', title: 'Negrita', node: el('span', { class: 'tx-bold' }, 'B') },
      { key: 'italic', title: 'Cursiva', node: el('span', { class: 'tx-italic' }, 'I') },
      { key: 'strike', title: 'Tachado', node: el('span', { class: 'tx-strike' }, 'S') },
    ], layer, set),
    row([
      numField('Tamaño', layer.fontSize, (v) => set({ fontSize: Math.max(6, v) })),
      rangeField('Interlínea', layer.lineHeight || 1.25, 0.8, 3, 0.05, (v) =>
        set({ lineHeight: v })
      ),
    ]),
    segField('Alineación', ALIGNMENTS, layer.align, (v) => set({ align: v }), (a) => alignIcon(a.value)),
    segField(
      'Columnas',
      [
        { value: 1, label: '1' },
        { value: 2, label: '2' },
        { value: 3, label: '3' },
      ],
      layer.columns,
      (v) => set({ columns: Number(v) })
    ),
  ]));
  host.appendChild(group('Color', [
    row([
      colorField('Letra', layer.color, (v) => set({ color: v })),
      colorField('Borde', layer.outlineColor, (v) => set({ outlineColor: v })),
    ]),
    numField('Grosor borde', layer.outlineWidth || 0, (v) =>
      set({ outlineWidth: Math.max(0, v) })
    ),
  ]));
}

function renderImageProps(host, layer) {
  host.appendChild(group('Imagen', [el('p', { class: 'li-sub' }, layer.assetName || 'Imagen')]));
}

function renderShapeProps(host, layer, set) {
  // Formas viejas (rect/ellipse) ya no están en el menú, pero se muestran por
  // compatibilidad si el documento las trae.
  const options = SHAPES.slice();
  const legacy = { rect: 'Rectángulo', ellipse: 'Óvalo' }[layer.shape];
  if (legacy && !options.some((o) => o.value === layer.shape)) options.unshift({ value: layer.shape, label: legacy });
  const select = el(
    'select',
    {},
    options.map((s) => el('option', { value: s.value, selected: s.value === layer.shape }, s.label)),
  );
  select.addEventListener('change', () => {
    const patch = { shape: select.value };
    // Cuadrado y círculo mantienen proporción 1:1.
    if (select.value === 'circle' || select.value === 'square') patch.h = layer.w;
    set(patch);
  });
  host.appendChild(group('Forma', [el('label', { class: 'prop-group' }, [el('span', {}, 'Tipo'), select])]));
  host.appendChild(group('Relleno y borde', [
    row([
      colorField('Relleno', layer.fill, (v) => set({ fill: v })),
      colorField('Borde', layer.stroke, (v) => set({ stroke: v })),
    ]),
    numField('Grosor borde', layer.strokeWidth || 0, (v) => set({ strokeWidth: Math.max(0, v) })),
  ]));
}

// ---- helpers de campos -------------------------------------------------
function group(label, children) {
  return el('div', { class: 'prop-group' }, [el('label', {}, label), ...children]);
}

function row(children) {
  return el('div', { class: 'prop-row' }, children);
}

function numField(label, value, onChange) {
  const input = el('input', { type: 'number', value: String(Math.round(value)) });
  input.addEventListener('change', () => onChange(Number(input.value)));
  return el('label', { class: 'prop-group', style: 'flex:1' }, [el('span', {}, label), input]);
}

function rangeField(label, value, min, max, step, onChange) {
  const val = el('span', {}, String(value));
  const input = el('input', { type: 'range', min, max, step, value: String(value) });
  input.addEventListener('input', () => {
    val.textContent = input.value;
    onChange(Number(input.value));
  });
  return el('div', { class: 'prop-group' }, [
    el('div', { class: 'prop-label-row' }, [el('span', {}, label), val]),
    input,
  ]);
}

function colorField(label, value, onChange) {
  const input = el('input', { type: 'color', value: value || '#000000' });
  input.addEventListener('input', () => onChange(input.value));
  return el('label', { class: 'prop-group', style: 'flex:1' }, [el('span', {}, label), input]);
}

function segField(label, options, current, onChange, labelFn) {
  const seg = el('div', { class: 'seg' });
  for (const opt of options) {
    const active = String(opt.value) === String(current);
    seg.appendChild(
      el('button', {
        class: active ? 'active' : '',
        onclick: () => {
          seg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          const btn = [...seg.children].find((b) => b.dataset.v === String(opt.value));
          if (btn) btn.classList.add('active');
          onChange(opt.value);
        },
        dataset: { v: String(opt.value) },
        title: opt.label,
      }, labelFn ? labelFn(opt) : opt.label)
    );
  }
  return el('div', { class: 'prop-group' }, [el('label', {}, label), seg]);
}

function toggleField(items, layer, set) {
  const row = el('div', { class: 'prop-row' });
  for (const it of items) {
    const btn = el('button', {
      class: 'btn toggle-btn' + (layer[it.key] ? ' active' : ''),
      title: it.title,
      onclick: () => {
        const next = !btn.classList.contains('active');
        btn.classList.toggle('active', next);
        set({ [it.key]: next });
      },
    }, it.node);
    row.appendChild(btn);
  }
  return el('div', { class: 'prop-group' }, [el('label', {}, 'Estilo'), row]);
}

const SVGNS = 'http://www.w3.org/2000/svg';
function alignIcon(kind) {
  // Icono de alineación estilo editor: cuatro barras horizontales.
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 14');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '14');
  svg.setAttribute('class', 'align-icon');
  const widths = kind === 'justify' ? [16, 16, 16, 16] : [16, 10, 16, 10];
  widths.forEach((w, i) => {
    const x = kind === 'right' ? 16 - w : kind === 'center' ? (16 - w) / 2 : 0;
    const r = document.createElementNS(SVGNS, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(i * 4));
    r.setAttribute('width', String(w));
    r.setAttribute('height', '2');
    r.setAttribute('rx', '1');
    r.setAttribute('fill', 'currentColor');
    svg.appendChild(r);
  });
  return svg;
}

// ---- modal de fanzines -------------------------------------------------
export function renderFanzineList() {
  const list = document.getElementById('fanzineList');
  list.innerHTML = '';
  for (const meta of store.state.fanzineList) {
    const isCurrent = store.state.current && store.state.current.id === meta.id;
    const li = el('li', { class: isCurrent ? 'current' : '' }, [
      el('span', { class: 'li-icon' }, '📕'),
      el('div', { class: 'meta' }, [
        el('strong', {}, meta.name),
        el('small', {}, `${meta.pages} pág. · ${new Date(meta.updatedAt).toLocaleString('es')}`),
      ]),
      el('button', { class: 'btn', onclick: async (e) => {
        e.stopPropagation();
        try {
          await io.exportFanzine(meta.id);
          toast('Fanzine exportado');
        } catch (err) {
          toast(err.message || 'No se pudo exportar');
        }
      } }, 'Exportar'),
      el('button', { class: 'btn btn-danger', onclick: async (e) => {
        e.stopPropagation();
        if (!confirm(`¿Borrar "${meta.name}" por completo? Esta acción no se puede deshacer.`)) return;
        await store.deleteFanzine(meta.id);
        toast('Fanzine borrado');
      } }, 'Borrar'),
    ]);
    li.addEventListener('click', async () => {
      await store.openFanzine(meta.id);
      closeModal();
      toast('Fanzine abierto');
    });
    list.appendChild(li);
  }
}

export function openModal() {
  renderFanzineList();
  document.getElementById('fanzineModal').classList.remove('hidden');
}
export function closeModal() {
  document.getElementById('fanzineModal').classList.add('hidden');
}

export function openAbout() {
  document.getElementById('aboutModal').classList.remove('hidden');
}
export function closeAbout() {
  document.getElementById('aboutModal').classList.add('hidden');
}

// ---- topbar ------------------------------------------------------------
export function syncTopbar() {
  if (!store.state.current) return;
  const s = store.state.current.settings;
  document.getElementById('orientation').value = s.orientation;
  document.getElementById('pageSize').value = s.size;
  document.getElementById('numberCorner').value = s.numberCorner;
  const g = s.guides || {};
  const setToggle = (btn, on) => {
    if (!btn) return;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  };
  const ruler = document.getElementById('guideRuler');
  const margins = document.getElementById('guideMargins');
  setToggle(ruler, !!g.ruler);
  setToggle(margins, !!g.margins);
  setToggle(document.getElementById('guideGrid'), !!g.grid);
  margins.disabled = !g.ruler;
  const modes = document.getElementById('marginModes');
  modes.hidden = !(g.ruler && g.margins);
  const mode = g.mode || 'overlay';
  setToggle(document.getElementById('marginModeOverlay'), mode === 'overlay');
  setToggle(document.getElementById('marginModeFit'), mode === 'fit');
}

// ---- historial ---------------------------------------------------------
export function syncHistory() {
  const undo = document.getElementById('btnUndo');
  const redo = document.getElementById('btnRedo');
  if (undo) undo.disabled = !store.canUndo();
  if (redo) redo.disabled = !store.canRedo();
}
