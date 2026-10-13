// main.js — punto de entrada: inicializa el store, el lienzo y los paneles,
// y conecta la barra superior y el modal de fanzines.

import * as store from './store.js';
import { initCanvas, render as renderCanvas } from './canvas.js';
import * as panels from './panels.js';
import { exportToPdf, exportBookletToPdf } from './pdf.js';
import { loadDetectedFonts, autoLoadSystemFonts } from './fonts.js';
import * as io from './io.js';

function $(id) {
  return document.getElementById(id);
}

async function boot() {
  initCanvas();
  panels.initPanels();
  wireTopbar();
  wireTopbarAlignment();
  wireSidebars();
  wireModal();
  wireImageInput();
  wirePaste();
  wireEvents();

  await store.init();

  // Detecta fuentes comunes instaladas (medición, sin permiso). Si aparece
  // alguna, refresca el panel de propiedades para poblar el selector.
  if (loadDetectedFonts()) {
    if (store.selectedLayer()) panels.renderLayerProps();
  }

  // Si el permiso 'local-fonts' YA estaba concedido (p. ej. PWA instalada),
  // carga TODAS las locales sin prompt. No puede abrir el diálogo por su cuenta:
  // el navegador exige un gesto del usuario para eso (queda el botón del panel).
  autoLoadSystemFonts().then((res) => {
    if (res.added && store.selectedLayer()) panels.renderLayerProps();
  });

  registerServiceWorker();
}

function wireEvents() {
  store.on('fanzine:opened', () => {
    panels.syncTopbar();
    panels.renderPageList();
    panels.renderLayerList();
    panels.renderLayerProps();
    renderCanvas();
  });
  store.on('settings:changed', panels.syncTopbar);
  store.on('fanzineList:changed', () => {
    if (!$('fanzineModal').classList.contains('hidden')) panels.renderFanzineList();
  });
  // Atajos de teclado globales: deshacer/rehacer, copiar/pegar y borrar.
  // Se ignoran mientras se escribe en un campo o hay un modal abierto.
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const editing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const modalOpen = !$('fanzineModal').classList.contains('hidden') || !$('aboutModal').classList.contains('hidden');
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === 'Escape') {
      if (!$('aboutModal').classList.contains('hidden')) {
        panels.closeAbout();
        return;
      }
      if (!$('fanzineModal').classList.contains('hidden')) {
        panels.closeModal();
        return;
      }
      return;
    }

    if (mod && !e.altKey && !editing) {
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey ? store.redo() : store.undo()) panels.toast(e.shiftKey ? 'Rehecho' : 'Deshecho');
        return;
      }
      if (k === 'y') {
        e.preventDefault();
        if (store.redo()) panels.toast('Rehecho');
        return;
      }
      if (k === 'c' && !modalOpen) {
        const kind = store.copySelection();
        if (kind) {
          e.preventDefault();
          panels.toast(kind === 'page' ? 'Página copiada' : 'Objeto copiado');
        }
        return;
      }
      if (k === 'v' && !modalOpen) {
        const kind = store.pasteClipboard();
        if (kind) {
          e.preventDefault();
          panels.toast(kind === 'page' ? 'Página pegada' : 'Objeto pegado');
        }
        return;
      }
    }

    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (editing || modalOpen) return;
    e.preventDefault();
    if (store.selectedLayer()) {
      store.deleteLayer(store.state.selectedLayerId);
      panels.toast('Objeto eliminado');
    } else if (store.state.current && store.state.current.pages.length > 1) {
      store.deletePage();
      panels.toast('Página eliminada');
    } else {
      panels.toast('Debe quedar al menos una página');
    }
  });
}

function wireTopbar() {
  $('orientation').addEventListener('change', (e) => store.setSettings({ orientation: e.target.value }));
  $('pageSize').addEventListener('change', (e) => store.setSettings({ size: e.target.value }));
  $('numberCorner').addEventListener('change', (e) => store.setSettings({ numberCorner: e.target.value }));
  $('btnExport').addEventListener('click', exportToPdf);
  $('btnExportBooklet').addEventListener('click', exportBookletToPdf);
  $('btnFanzines').addEventListener('click', panels.openModal);
  $('btnAbout').addEventListener('click', panels.openAbout);
  $('btnUndo').addEventListener('click', () => {
    if (store.undo()) panels.toast('Deshecho');
  });
  $('btnRedo').addEventListener('click', () => {
    if (store.redo()) panels.toast('Rehecho');
  });

  const setGuides = (patch) => {
    const g = { ...(store.state.current.settings.guides || {}), ...patch };
    store.setSettings({ guides: g });
  };
  const guides = () => store.state.current.settings.guides || {};
  $('guideRuler').addEventListener('click', () => {
    const on = !guides().ruler;
    setGuides(on ? { ruler: true } : { ruler: false, margins: false });
  });
  $('guideMargins').addEventListener('click', () => {
    if (!guides().ruler) return;
    setGuides({ margins: !guides().margins });
  });
  $('guideGrid').addEventListener('click', () => setGuides({ grid: !guides().grid }));
  $('marginModeOverlay').addEventListener('click', () => setGuides({ mode: 'overlay' }));
  $('marginModeFit').addEventListener('click', () => setGuides({ mode: 'fit' }));
}

// La tríada de acciones se ancla a la derecha mientras quede espacio; cuando la
// ventana se estrecha y salta a una segunda línea (por debajo de la tríada de
// guías), se marca como "wrapped" para que quede anclada a la izquierda.
function wireTopbarAlignment() {
  const topbar = document.querySelector('.topbar');
  const group = document.querySelector('.topbar-right');
  const prev = document.querySelector('.guides-field');
  if (!topbar || !group || !prev) return;
  const update = () => {
    const wrapped = group.getBoundingClientRect().bottom - prev.getBoundingClientRect().bottom > 4;
    group.classList.toggle('wrapped', wrapped);
  };
  update();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(topbar);
  window.addEventListener('resize', update);
}

function wireSidebars() {
  $('btnAddPage').addEventListener('click', () => {
    store.addPage();
    panels.toast('Página agregada');
  });
  $('btnDeletePage').addEventListener('click', () => {
    if (store.state.current.pages.length <= 1) {
      panels.toast('Debe quedar al menos una página');
      return;
    }
    store.deletePage();
    panels.toast('Página borrada');
  });
  $('btnAddText').addEventListener('click', () => {
    store.addTextLayer();
    panels.toast('Cuadro de texto agregado');
  });
  $('btnAddImage').addEventListener('click', () => $('imageInput').click());
  $('btnAddShape').addEventListener('click', () => {
    store.addShapeLayer();
    panels.toast('Forma agregada');
  });
}

function wireImageInput() {
  const input = $('imageInput');
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      await store.addImageLayer(file);
    }
    if (files.length) panels.toast(`${files.length} imagen(es) agregada(s)`);
  });
}

// Pegar imágenes desde el portapapeles (Ctrl/Cmd+V) crea capas de imagen.
function wirePaste() {
  document.addEventListener('paste', async (e) => {
    if (!store.state.current) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const files = [];
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) await store.addImageLayer(f);
    panels.toast(files.length > 1 ? `${files.length} imágenes pegadas` : 'Imagen pegada');
  });
}

function wireModal() {
  $('btnCloseModal').addEventListener('click', panels.closeModal);
  $('fanzineModal').addEventListener('click', (e) => {
    if (e.target === $('fanzineModal')) panels.closeModal();
  });
  $('btnCloseAbout').addEventListener('click', panels.closeAbout);
  $('aboutModal').addEventListener('click', (e) => {
    if (e.target === $('aboutModal')) panels.closeAbout();
  });
  $('btnNewFanzine').addEventListener('click', async () => {
    const name = prompt('Nombre del nuevo fanzine:', `Fanzine ${new Date().toLocaleDateString('es')}`);
    if (name === null) return;
    await store.createFanzine(name.trim() || undefined);
    panels.closeModal();
    panels.toast('Fanzine creado');
  });

  $('btnExportAll').addEventListener('click', async () => {
    try {
      const n = await io.exportAllFanzines();
      panels.toast(`${n} fanzine(s) exportado(s)`);
    } catch (err) {
      panels.toast(err.message || 'No se pudo exportar');
    }
  });

  $('btnImport').addEventListener('click', () => $('importInput').click());
  $('importInput').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const n = await io.importFile(file);
      await store.reloadList();
      panels.toast(`${n} fanzine(s) importado(s)`);
    } catch (err) {
      panels.toast(err.message || 'No se pudo importar');
    }
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.warn('Service worker no registrado:', err);
    });
  });
}

// Guarda de salida: fuerza el volcado a IndexedDB antes de cerrar.
window.addEventListener('beforeunload', () => {
  store.saveCurrent();
});

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#f88;padding:24px">Error al iniciar: ${err.message}</pre>`;
});
