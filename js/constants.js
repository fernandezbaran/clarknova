// constants.js — tamaños de página, fuentes y valores por defecto.

export const MM_TO_PX = 96 / 25.4; // 1 mm en píxeles CSS a 96 dpi

// Tamaños en milímetros (ancho, alto) en orientación vertical.
export const PAGE_SIZES = {
  A4: { label: 'A4', w: 210, h: 297 },
  A5: { label: 'A5', w: 148, h: 210 },
  Letter: { label: 'Carta', w: 215.9, h: 279.4 },
  Legal: { label: 'Oficio', w: 215.9, h: 355.6 },
  Tabloid: { label: 'Tabloide', w: 279.4, h: 431.8 },
};

// Fuentes curadas. Se amplían con las del sistema si queryLocalFonts está disponible.
export const CURATED_FONTS = [
  { family: 'system-ui', label: 'Sistema' },
  { family: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { family: 'Georgia, serif', label: 'Georgia' },
  { family: '"Times New Roman", Times, serif', label: 'Times New Roman' },
  { family: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { family: 'Tahoma, sans-serif', label: 'Tahoma' },
  { family: '"Trebuchet MS", sans-serif', label: 'Trebuchet MS' },
  { family: '"Courier New", Courier, monospace', label: 'Courier New' },
  { family: '"Comic Sans MS", cursive', label: 'Comic Sans MS' },
  { family: 'Impact, sans-serif', label: 'Impact' },
  { family: '"Palatino Linotype", Palatino, serif', label: 'Palatino' },
  { family: 'Garamond, serif', label: 'Garamond' },
  { family: '"Segoe UI", sans-serif', label: 'Segoe UI' },
  { family: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
];

// Candidatas comunes para la detección por medición (Font Access API ausente o
// permiso denegado): Firefox/Safari y demás. No es una enumeración del sistema,
// sino un sondeo de familias que suelen venir instaladas en Windows/macOS/Linux.
export const FONT_CANDIDATES = [
  // Windows
  'Arial Black', 'Calibri', 'Cambria', 'Candara', 'Consolas', 'Constantia',
  'Corbel', 'Franklin Gothic Medium', 'Gabriola', 'Lucida Console',
  'Lucida Sans Unicode', 'Microsoft Sans Serif', 'MS Gothic', 'MS Mincho',
  'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Sylfaen', 'Symbol',
  'Webdings', 'Wingdings', 'Book Antiqua', 'Bookman Old Style', 'Century Gothic',
  'Garamond', 'Georgia', 'Impact', 'Marlett', 'Meiryo', 'MS PGothic',
  'MS PMincho', 'NSimSun', 'SimSun', 'SimHei', 'MingLiU', 'PMingLiU',
  'Batang', 'Gulim', 'Malgun Gothic', 'Courier New', 'Verdana', 'Tahoma',
  'Trebuchet MS', 'Comic Sans MS', 'Segoe UI', 'Times New Roman',
  // macOS
  'American Typewriter', 'Andale Mono', 'Apple Chancery', 'Avenir',
  'Avenir Next', 'Baskerville', 'Big Caslon', 'Bodoni 72', 'Bradley Hand',
  'Brush Script MT', 'Chalkboard', 'Chalkduster', 'Cochin', 'Copperplate',
  'Didot', 'Futura', 'Geneva', 'Gill Sans', 'Helvetica Neue', 'Herculanum',
  'Hoefler Text', 'Lucida Grande', 'Luminari', 'Marker Felt', 'Menlo',
  'Monaco', 'Noteworthy', 'Optima', 'Papyrus', 'Phosphate', 'Rockwell',
  'Savoye LET', 'Skia', 'Snell Roundhand', 'Trattatello', 'Zapfino',
  'SF Pro', 'SF Mono', 'New York',
  // Linux / libres
  'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono', 'Liberation Sans',
  'Liberation Serif', 'Liberation Mono', 'Ubuntu', 'Ubuntu Mono', 'Cantarell',
  'Noto Sans', 'Noto Serif', 'Noto Sans Mono', 'FreeSans', 'FreeSerif',
  'Nimbus Sans', 'Nimbus Roman', 'Bitstream Vera Sans', 'Droid Sans',
];

export const ALIGNMENTS = [
  { value: 'left', label: 'Izquierda' },
  { value: 'center', label: 'Centro' },
  { value: 'right', label: 'Derecha' },
  { value: 'justify', label: 'Justificado' },
];

// Formas disponibles. Cuadrado y círculo arrancan 1:1 pero pueden estirarse a
// rectángulo u óvalo arrastrando los tiradores.
export const SHAPES = [
  { value: 'square', label: 'Cuadrado' },
  { value: 'circle', label: 'Círculo' },
  { value: 'triangle', label: 'Triángulo' },
];

export function defaultSettings() {
  return {
    size: 'A4',
    orientation: 'portrait',
    numberCorner: 'none',
    guides: {
      ruler: false,
      margins: false,
      grid: false,
      mode: 'overlay',
      margin: { top: 10, right: 10, bottom: 10, left: 10 },
    },
  };
}

export function defaultTextElement(overrides = {}) {
  return {
    type: 'text',
    text: 'Escribe aquí…',
    fontFamily: 'system-ui',
    fontSize: 18,
    align: 'left',
    color: '#111111',
    outlineColor: '#ffffff',
    outlineWidth: 0,
    columns: 1,
    lineHeight: 1.25,
    bold: false,
    italic: false,
    strike: false,
    opacity: 1,
    ...overrides,
  };
}

export function defaultShapeElement(overrides = {}) {
  return {
    type: 'shape',
    shape: 'square',
    fill: '#4d7cff',
    stroke: '#111111',
    strokeWidth: 2,
    opacity: 1,
    ...overrides,
  };
}

// Dimensiones en píxeles de la página según tamaño + orientación.
export function pageDimensions(settings) {
  const size = PAGE_SIZES[settings.size] || PAGE_SIZES.A4;
  let w = size.w * MM_TO_PX;
  let h = size.h * MM_TO_PX;
  if (settings.orientation === 'landscape') [w, h] = [h, w];
  return { width: Math.round(w), height: Math.round(h) };
}
