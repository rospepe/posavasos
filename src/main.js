import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { parse as parseFont } from 'opentype.js';
import { DEFAULTS, withDefaults, parseSvg } from './coaster.js';
import { FONTS } from './fonts.js';
import { toSTL } from './stl.js';

const STORAGE_KEY = 'posavasos:v1';
const PLA_DENSITY = 1.24; // g/cm³

// ---------------------------------------------------------------------------
// Estado

const clone = (o) => JSON.parse(JSON.stringify(o));
let params = loadParams();
const customFonts = []; // { id, name }

function loadParams() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      const p = withDefaults(saved);
      // Las fuentes subidas no se guardan: si faltan, se vuelve a la predeterminada.
      if (!FONTS.some((f) => f.id === p.text.font)) p.text.font = DEFAULTS.text.font;
      if (!FONTS.some((f) => f.id === p.spiral.font)) p.spiral.font = DEFAULTS.spiral.font;
      return p;
    }
  } catch {
    /* almacenamiento no disponible */
  }
  return withDefaults(clone(DEFAULTS));
}

function saveParams() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    /* sin espacio o bloqueado: no es imprescindible */
  }
}

const get = (path) => path.split('.').reduce((o, k) => o?.[k], params);
const set = (path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], params)[last] = value;
};

// ---------------------------------------------------------------------------
// Definición del formulario

const MODE = [
  ['emboss', 'Relieve'],
  ['engrave', 'Grabado'],
];

const SECTIONS = [
  {
    title: 'Forma',
    fields: [
      {
        path: 'shape',
        type: 'segmented',
        options: [
          ['circle', 'Círculo'],
          ['square', 'Cuadrado'],
          ['hexagon', 'Hexágono'],
          ['octagon', 'Octógono'],
          ['heart', 'Corazón'],
        ],
      },
      { path: 'size', label: 'Tamaño', type: 'range', min: 50, max: 160, step: 1, unit: 'mm' },
      {
        path: 'cornerRadius',
        label: 'Radio de las esquinas',
        type: 'range',
        min: 0,
        max: 40,
        step: 0.5,
        unit: 'mm',
        show: (p) => p.shape === 'square',
      },
      { path: 'thickness', label: 'Grosor de la base', type: 'range', min: 2, max: 10, step: 0.2, unit: 'mm' },
      {
        path: 'quality',
        label: 'Calidad de la malla',
        type: 'select',
        options: [
          ['draft', 'Borrador (rápido)'],
          ['normal', 'Normal'],
          ['high', 'Alta (archivo más grande)'],
        ],
      },
    ],
  },
  {
    title: 'Borde',
    toggle: 'border.enabled',
    fields: [
      { path: 'border.width', label: 'Ancho', type: 'range', min: 1, max: 15, step: 0.5, unit: 'mm' },
      { path: 'border.height', label: 'Altura', type: 'range', min: 0.4, max: 5, step: 0.1, unit: 'mm' },
    ],
  },
  {
    title: 'Texto',
    toggle: 'text.enabled',
    fields: [
      { path: 'text.content', label: 'Texto (Intro para otra línea)', type: 'textarea' },
      { path: 'text.font', label: 'Tipografía', type: 'font' },
      { path: 'text.mode', type: 'segmented', options: MODE },
      { path: 'text.size', label: 'Tamaño de letra', type: 'range', min: 4, max: 50, step: 0.5, unit: 'mm' },
      { path: 'text.depth', label: 'Profundidad / altura', type: 'range', min: 0.2, max: 4, step: 0.1, unit: 'mm' },
      { path: 'text.offsetX', label: 'Posición horizontal', type: 'range', min: -60, max: 60, step: 0.5, unit: 'mm' },
      { path: 'text.offsetY', label: 'Posición vertical', type: 'range', min: -60, max: 60, step: 0.5, unit: 'mm' },
      { path: 'text.letterSpacing', label: 'Espaciado entre letras', type: 'range', min: -3, max: 8, step: 0.1, unit: 'mm' },
      {
        path: 'text.lineSpacing',
        label: 'Interlineado',
        type: 'range',
        min: 0.6,
        max: 2,
        step: 0.05,
        unit: '×',
        show: (p) => String(p.text.content).includes('\n'),
      },
    ],
  },
  {
    title: 'Texto en espiral',
    toggle: 'spiral.enabled',
    fields: [
      { type: 'hint', text: 'Recorre el posavasos desde el borde hacia el centro siguiendo su forma.' },
      { path: 'spiral.content', label: 'Texto', type: 'textarea' },
      { path: 'spiral.repeat', label: 'Repetir hasta llenar la espiral', type: 'checkbox' },
      { path: 'spiral.separator', label: 'Separador entre repeticiones', type: 'text', show: (p) => p.spiral.repeat },
      { path: 'spiral.font', label: 'Tipografía', type: 'font' },
      { path: 'spiral.mode', type: 'segmented', options: MODE },
      { path: 'spiral.size', label: 'Tamaño de letra al empezar (borde)', type: 'range', min: 3, max: 20, step: 0.5, unit: 'mm' },
      { path: 'spiral.sizeEnd', label: 'Tamaño de letra al terminar (centro)', type: 'range', min: 2, max: 20, step: 0.5, unit: 'mm' },
      {
        path: 'spiral.adaptive',
        label: 'Adaptar el tamaño al espacio (letras mayores donde hay más sitio)',
        type: 'checkbox',
      },
      {
        path: 'spiral.fit',
        label: 'Ajuste perfecto (el texto termina justo al final, retocando el tamaño)',
        type: 'checkbox',
      },
      { path: 'spiral.depth', label: 'Profundidad / altura', type: 'range', min: 0.2, max: 3, step: 0.1, unit: 'mm' },
      { path: 'spiral.lineSpacing', label: 'Separación entre vueltas', type: 'range', min: 1, max: 3, step: 0.05, unit: '×' },
      { path: 'spiral.letterSpacing', label: 'Espaciado entre letras', type: 'range', min: -1, max: 4, step: 0.1, unit: 'mm' },
      { path: 'spiral.innerRadius', label: 'Hueco central', type: 'range', min: 0, max: 60, step: 1, unit: 'mm' },
      { path: 'spiral.startAngle', label: 'Punto de inicio', type: 'range', min: 0, max: 360, step: 5, unit: '°' },
    ],
  },
  {
    title: 'Logotipo (SVG)',
    toggle: 'logo.enabled',
    fields: [
      { path: 'logo.contours', label: 'Archivo SVG', type: 'svg' },
      { path: 'logo.mode', type: 'segmented', options: MODE },
      { path: 'logo.size', label: 'Tamaño', type: 'range', min: 5, max: 140, step: 0.5, unit: 'mm' },
      { path: 'logo.depth', label: 'Profundidad / altura', type: 'range', min: 0.2, max: 4, step: 0.1, unit: 'mm' },
      { path: 'logo.offsetX', label: 'Posición horizontal', type: 'range', min: -60, max: 60, step: 0.5, unit: 'mm' },
      { path: 'logo.offsetY', label: 'Posición vertical', type: 'range', min: -60, max: 60, step: 0.5, unit: 'mm' },
    ],
  },
  {
    title: 'Patrón de fondo',
    fields: [
      {
        path: 'pattern.type',
        type: 'segmented',
        options: [
          ['none', 'Ninguno'],
          ['rings', 'Anillos'],
          ['dots', 'Puntos'],
          ['stripes', 'Rayas'],
          ['waves', 'Ondas'],
        ],
      },
      { path: 'pattern.mode', type: 'segmented', options: MODE, show: hasPattern },
      { path: 'pattern.depth', label: 'Profundidad / altura', type: 'range', min: 0.2, max: 3, step: 0.1, unit: 'mm', show: hasPattern },
      { path: 'pattern.spacing', label: 'Separación', type: 'range', min: 2, max: 20, step: 0.5, unit: 'mm', show: hasPattern },
      { path: 'pattern.width', label: 'Grosor del trazo', type: 'range', min: 0.4, max: 6, step: 0.1, unit: 'mm', show: hasPattern },
      {
        path: 'pattern.clearance',
        label: 'Espacio libre alrededor del texto y logo',
        type: 'range',
        min: 0,
        max: 10,
        step: 0.5,
        unit: 'mm',
        show: hasPattern,
      },
      { path: 'pattern.margin', label: 'Margen con el borde', type: 'range', min: 0, max: 10, step: 0.5, unit: 'mm' },
    ],
  },
  {
    title: 'Hueco para corcho o fieltro',
    toggle: 'recess.enabled',
    fields: [
      { type: 'hint', text: 'Rebaje en la cara inferior para pegar una lámina antideslizante.' },
      { path: 'recess.inset', label: 'Margen desde el borde', type: 'range', min: 1, max: 25, step: 0.5, unit: 'mm' },
      { path: 'recess.depth', label: 'Profundidad', type: 'range', min: 0.4, max: 3, step: 0.1, unit: 'mm' },
    ],
  },
];

function hasPattern(p) {
  return p.pattern.type !== 'none';
}

// ---------------------------------------------------------------------------
// Renderizado del formulario

const form = document.getElementById('controls');
const fmt = (v, step) => (step < 1 ? Number(v).toFixed(String(step).split('.')[1].length) : String(v));
let uid = 0;

function buildForm() {
  form.innerHTML = '';
  for (const section of SECTIONS) {
    const fs = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = section.title;
    fs.append(legend);
    if (section.toggle) {
      const sw = document.createElement('label');
      sw.className = 'switch';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!get(section.toggle);
      cb.setAttribute('aria-label', `Activar ${section.title.toLowerCase()}`);
      cb.addEventListener('change', () => {
        set(section.toggle, cb.checked);
        fs.classList.toggle('off', !cb.checked);
        changed();
      });
      sw.append(cb, 'Activar');
      legend.append(sw);
      fs.classList.toggle('off', !cb.checked);
    }
    for (const field of section.fields) fs.append(renderField(field));
    form.append(fs);
  }
  refreshVisibility();
}

function renderField(f) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap._field = f;
  const id = `f${++uid}`;
  const label = () => {
    const l = document.createElement('label');
    l.htmlFor = id;
    l.textContent = f.label;
    return l;
  };

  switch (f.type) {
    case 'hint': {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = f.text;
      wrap.append(p);
      break;
    }
    case 'range': {
      const input = document.createElement('input');
      Object.assign(input, { type: 'range', id, min: f.min, max: f.max, step: f.step, value: get(f.path) });
      const out = document.createElement('output');
      out.htmlFor = id;
      const show = () => (out.textContent = `${fmt(input.value, f.step)} ${f.unit}`);
      show();
      input.addEventListener('input', () => {
        set(f.path, Number(input.value));
        show();
        changed();
      });
      // Doble clic en el valor: vuelve al valor por defecto.
      out.title = 'Doble clic para restablecer';
      out.addEventListener('dblclick', () => {
        input.value = f.path.split('.').reduce((o, k) => o[k], DEFAULTS);
        input.dispatchEvent(new Event('input'));
      });
      wrap.append(label(), out, input);
      break;
    }
    case 'select': {
      const sel = document.createElement('select');
      sel.id = id;
      for (const [v, t] of f.options) sel.add(new Option(t, v, false, v === get(f.path)));
      sel.addEventListener('change', () => {
        set(f.path, sel.value);
        changed();
      });
      wrap.append(label(), sel);
      break;
    }
    case 'segmented': {
      const group = document.createElement('div');
      group.className = 'segmented';
      group.setAttribute('role', 'radiogroup');
      for (const [v, t] of f.options) {
        const l = document.createElement('label');
        const r = document.createElement('input');
        Object.assign(r, { type: 'radio', name: id, value: v, checked: get(f.path) === v });
        r.addEventListener('change', () => {
          set(f.path, v);
          changed();
        });
        const span = document.createElement('span');
        span.textContent = t;
        span.title = t;
        l.append(r, span);
        group.append(l);
      }
      wrap.append(group);
      break;
    }
    case 'checkbox': {
      const cb = document.createElement('input');
      Object.assign(cb, { type: 'checkbox', id, checked: !!get(f.path) });
      cb.addEventListener('change', () => {
        set(f.path, cb.checked);
        changed();
      });
      const l = label();
      l.className = 'switch';
      l.prepend(cb);
      wrap.append(l);
      break;
    }
    case 'text': {
      const input = document.createElement('input');
      Object.assign(input, { type: 'text', id, value: get(f.path) });
      input.addEventListener('input', () => {
        set(f.path, input.value);
        changed();
      });
      wrap.append(label(), input);
      break;
    }
    case 'textarea': {
      const ta = document.createElement('textarea');
      ta.id = id;
      ta.rows = 2;
      ta.value = get(f.path);
      ta.addEventListener('input', () => {
        set(f.path, ta.value);
        changed();
      });
      wrap.append(label(), ta);
      break;
    }
    case 'font': {
      const sel = document.createElement('select');
      sel.id = id;
      const fill = () => {
        sel.innerHTML = '';
        for (const fo of [...FONTS, ...customFonts]) sel.add(new Option(fo.name, fo.id, false, fo.id === get(f.path)));
      };
      fill();
      sel.addEventListener('change', () => {
        set(f.path, sel.value);
        changed();
      });
      const file = fileButton('Subir fuente (.ttf, .otf, .woff)', '.ttf,.otf,.woff', async (fileObj, setName) => {
        const buffer = await fileObj.arrayBuffer();
        let font;
        try {
          font = parseFont(buffer.slice(0));
        } catch (e) {
          setStatus(`No se pudo leer la fuente: ${e.message}`, 'error');
          return;
        }
        const fid = `custom-${customFonts.length + 1}`;
        const family = font.names?.fontFamily?.en || fileObj.name;
        customFonts.push({ id: fid, name: `${family} (subida)` });
        worker.postMessage({ type: 'font', id: fid, buffer }, [buffer]);
        set(f.path, fid);
        fill();
        setName(fileObj.name);
        changed();
      });
      wrap.append(label(), sel, file);
      break;
    }
    case 'svg': {
      const file = fileButton(
        get(f.path) ? 'Cambiar SVG' : 'Elegir SVG',
        '.svg,image/svg+xml',
        async (fileObj, setName) => {
          try {
            const contours = parseSvg(await fileObj.text());
            if (!contours.length) throw new Error('no contiene formas rellenas');
            set(f.path, contours);
            setName(fileObj.name);
            changed();
          } catch (e) {
            setStatus(`No se pudo leer el SVG: ${e.message}`, 'error');
          }
        },
      );
      if (get(f.path)) file.querySelector('.name').textContent = 'SVG guardado';
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Se usan las formas con relleno; los trazos sin relleno se ignoran.';
      wrap.append(label(), file, hint);
      break;
    }
  }
  return wrap;
}

function fileButton(text, accept, onFile) {
  const box = document.createElement('div');
  box.className = 'file';
  const input = document.createElement('input');
  Object.assign(input, { type: 'file', accept, hidden: true });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;
  btn.addEventListener('click', () => input.click());
  const name = document.createElement('span');
  name.className = 'name';
  input.addEventListener('change', () => {
    if (input.files[0]) onFile(input.files[0], (n) => (name.textContent = n));
    input.value = '';
  });
  box.append(btn, name, input);
  return box;
}

function refreshVisibility() {
  for (const el of form.querySelectorAll('.field')) {
    const show = el._field?.show;
    if (show) el.hidden = !show(params);
  }
}

// ---------------------------------------------------------------------------
// Visor 3D

const container = document.getElementById('viewer');
// Sin WebGL no hay vista previa, pero se puede seguir generando y descargando el STL.
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.append(renderer.domElement);
} catch {
  const msg = document.createElement('p');
  msg.className = 'no-webgl';
  msg.textContent = 'Este equipo no permite la vista previa 3D (WebGL), pero puedes descargar el STL igualmente.';
  container.append(msg);
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer?.domElement ?? container);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f72, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-80, -120, 200);
scene.add(sun);
const rim = new THREE.DirectionalLight(0xffffff, 0.6);
rim.position.set(120, 100, 60);
scene.add(rim);

const grid = new THREE.GridHelper(300, 30, 0x9a9187, 0xbdb5aa);
grid.rotation.x = Math.PI / 2;
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

const material = new THREE.MeshStandardMaterial({
  color: document.getElementById('previewColor').value,
  roughness: 0.55,
  metalness: 0.02,
});
const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
scene.add(mesh);

function resetView() {
  const r = Math.max(params.size, 60);
  camera.position.set(0, -r * 1.55, r * 1.45);
  controls.target.set(0, 0, 0);
  controls.update();
}

function resize() {
  const { clientWidth: w, clientHeight: h } = container;
  if (!w || !h || !renderer) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(container);

renderer?.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

document.getElementById('resetView').addEventListener('click', resetView);
document.getElementById('topView').addEventListener('click', () => {
  // Justo encima (con un pelín de inclinación para que OrbitControls no se bloquee).
  const r = Math.max(params.size, 60);
  camera.position.set(0, -0.001, r * 2.6);
  controls.target.set(0, 0, 0);
  controls.update();
});
document.getElementById('previewColor').addEventListener('input', (e) => material.color.set(e.target.value));

// ---------------------------------------------------------------------------
// Generación en segundo plano

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const statusEl = document.getElementById('status');
const downloadBtn = document.getElementById('download');
let requestId = 0;
let timer = null;
let latest = null;

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

function changed() {
  refreshVisibility();
  saveParams();
  clearTimeout(timer);
  timer = setTimeout(requestBuild, 120);
}

function requestBuild() {
  setStatus('Generando…', 'busy');
  worker.postMessage({ type: 'build', id: ++requestId, params });
}

worker.onmessage = ({ data }) => {
  if (data.id !== requestId) return; // resultado obsoleto
  if (data.type === 'error') {
    setStatus(`Error al generar: ${data.message}`, 'error');
    return;
  }
  latest = data;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  g.setIndex(new THREE.BufferAttribute(data.indices, 1));
  const shaded = toCreasedNormals(g, Math.PI / 6);
  g.dispose();
  mesh.geometry.dispose();
  mesh.geometry = shaded;
  downloadBtn.disabled = false;
  setStatus('Listo');
  showInfo(data);
};

worker.onerror = (e) => setStatus(`Error en el generador: ${e.message || 'desconocido'}`, 'error');

function showInfo(r) {
  const [x, y, z] = r.size;
  const cm3 = r.volume / 1000;
  const stats = [
    ['Dimensiones', `${x.toFixed(1)} × ${y.toFixed(1)} × ${z.toFixed(1)} mm`],
    ['Volumen', `${cm3.toFixed(1)} cm³`],
    ['Peso aprox. (PLA macizo)', `${Math.round(cm3 * PLA_DENSITY)} g`],
    ['Triángulos', (r.indices.length / 3).toLocaleString('es')],
  ];
  document.getElementById('stats').innerHTML = stats
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('');

  const list = document.getElementById('warnings');
  list.innerHTML = '';
  for (const w of r.warnings) {
    const li = document.createElement('li');
    li.textContent = w;
    list.append(li);
  }
  const embossed =
    (params.border.enabled) ||
    (params.text.enabled && params.text.mode === 'emboss') ||
    (params.logo.enabled && params.logo.contours && params.logo.mode === 'emboss') ||
    (params.spiral.enabled && params.spiral.mode === 'emboss') ||
    (params.pattern.type !== 'none' && params.pattern.mode === 'emboss');
  if (embossed) {
    const li = document.createElement('li');
    li.className = 'tip';
    li.textContent = `Consejo: para imprimir el relieve en otro color, añade un cambio de filamento en la primera capa por encima de ${params.thickness.toFixed(1)} mm.`;
    list.append(li);
  }
}

downloadBtn.addEventListener('click', () => {
  if (!latest) return;
  const slug =
    (params.text.enabled ? params.text.content : params.spiral.enabled ? params.spiral.content : '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || params.shape;
  const blob = new Blob([toSTL(latest.positions, latest.indices, slug)], { type: 'model/stl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `posavasos-${slug}.stl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

document.getElementById('reset').addEventListener('click', () => {
  params = withDefaults(clone(DEFAULTS));
  buildForm();
  resetView();
  changed();
});

// ---------------------------------------------------------------------------

buildForm();
resize();
resetView();
requestBuild();
