/* MAMUTS · Módulos Habitacionales — lógica de la interfaz */

const $ = (sel) => document.querySelector(sel);
const TZ_ARGENTINA = 'America/Argentina/Buenos_Aires';

let modulosCache = [];
let hoyServidor = null;
let mesCronograma = null;
let detalleModuloId = null;

// ---------- Utilidades ----------
async function api(url, opciones = {}) {
  const res = await fetch(url, opciones);
  let datos = null;
  try { datos = await res.json(); } catch { /* respuesta sin JSON */ }
  if (res.status === 401) { window.location.replace('index.html'); throw new Error('Sesión vencida'); }
  if (!res.ok) throw new Error((datos && datos.error) || 'Error inesperado del servidor');
  return datos;
}

function escapar(texto) {
  return String(texto == null ? '' : texto)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatearFecha(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function fechaISOArgentina() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ_ARGENTINA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function nombreMes(mesISO) {
  const [a, m] = mesISO.split('-').map(Number);
  const texto = new Date(a, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

let avisoTimer = null;
function aviso(texto) {
  let el = $('#aviso');
  if (!el) { el = document.createElement('div'); el.id = 'aviso'; document.body.appendChild(el); }
  el.textContent = texto;
  el.classList.add('visible');
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => el.classList.remove('visible'), 3000);
}

function mostrarError(idElemento, mensaje) {
  const el = $(idElemento);
  el.textContent = mensaje;
  el.classList.remove('oculto');
}

function medidasTexto(m) {
  const partes = [m.largo, m.ancho, m.alto].filter((n) => n != null);
  if (!partes.length) return '–';
  return partes.map((n) => Number(n).toLocaleString('es-AR')).join(' × ') + ' m';
}

// Reutiliza el sistema de etiquetas del sistema de flota
function etiquetaEstado(estado) {
  const clase = {
    'Pendiente': 'etiqueta-categoria',
    'En reparación': 'etiqueta-alerta',
    'Terminado': 'etiqueta-ok',
    'Entregado': 'etiqueta-rol',
    'Pedido': 'etiqueta-alerta',
    'Comprado': 'etiqueta-ok'
  }[estado] || 'etiqueta-categoria';
  return `<span class="etiqueta ${clase}">${escapar(estado)}</span>`;
}

// Barra de avance. Con `editable`, permite corregir el porcentaje a mano.
function barraAvance(avance, moduloId, editable) {
  const n = Number(avance || 0);
  const control = editable
    ? `<input type="range" class="barra-rango" min="0" max="100" step="5" value="${n}" data-avance-modulo="${moduloId}" aria-label="Avance del módulo">`
    : `<span class="barra-pista"><span class="barra-relleno" style="width:${n}%"></span></span>`;
  return `<span class="barra-caja">${control}<span class="barra-num">${n}%</span></span>`;
}

// ---------- Sesión ----------
async function verificarSesion() {
  let me;
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.replace('index.html'); return; }
    me = await res.json();
  } catch {
    window.location.replace('index.html');
    return;
  }
  window.ES_ADMIN = !!me.es_admin;
  window.PERMISOS = new Set(me.permisos || []);
  $('#usuario-actual').textContent = me.username;
  $('#verificando').classList.add('oculto');
  $('#app').classList.remove('oculto');
  await iniciar();
}

async function iniciar() {
  hoyServidor = fechaISOArgentina();
  mesCronograma = hoyServidor.slice(0, 7);
  $('#filtro-parte-fecha').value = hoyServidor;
  await cargarModulos();
  irASeccion('inventario');
}

// ---------- Navegación ----------
function mostrarSeccion(id) {
  document.querySelectorAll('.seccion').forEach((s) => s.classList.add('oculto'));
  $(`#${id}`).classList.remove('oculto');
}

function irASeccion(nombre) {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('activo', b.dataset.seccion === nombre));
  mostrarSeccion(`seccion-${nombre}`);
  if (nombre === 'inventario') cargarModulos();
  if (nombre === 'reparaciones') cargarPartes();
  if (nombre === 'cronograma') cargarCronograma();
  if (nombre === 'materiales') cargarMateriales();
  if (nombre === 'documentacion') cargarDocumentos();
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => irASeccion(btn.dataset.seccion));
});

document.querySelectorAll('dialog [data-cerrar]').forEach((btn) => {
  btn.addEventListener('click', () => btn.closest('dialog').close());
});

// Ver cualquier foto en grande
document.addEventListener('click', (e) => {
  const mini = e.target.closest('[data-foto]');
  if (mini) {
    $('#modal-foto-img').src = '/uploads/' + encodeURIComponent(mini.dataset.foto);
    $('#modal-foto').showModal();
  }
});

// ---------- Inventario ----------
async function cargarModulos() {
  const inactivos = $('#ver-modulos-baja').checked ? '?inactivos=1' : '';
  modulosCache = await api('/api/modulos' + inactivos);
  const cuerpo = $('#tabla-modulos tbody');
  cuerpo.innerHTML = modulosCache.map((m) => `
    <tr>
      <td><strong>${escapar(m.bien_capital)}</strong>${m.activo ? '' : ' <span class="etiqueta etiqueta-baja">BAJA</span>'}</td>
      <td>${escapar(m.tipo || '–')}</td>
      <td>${medidasTexto(m)}</td>
      <td>${escapar(m.cliente || '–')}</td>
      <td>${escapar(m.ubicacion || '–')}</td>
      <td>${etiquetaEstado(m.estado)}</td>
      <td class="celda-barra">${barraAvance(m.avance, m.id, false)}</td>
      <td class="num">${m.fotos}</td>
      <td class="celda-acciones">
        <button class="btn btn-chico" data-ver="${m.id}">Ver</button>
        <button class="btn btn-chico" data-editar="${m.id}">Editar</button>
        <button class="btn btn-chico btn-peligro" data-baja="${m.id}" data-activo="${m.activo}">${m.activo ? 'Dar de baja' : 'Reactivar'}</button>
      </td>
    </tr>
  `).join('');
  $('#modulos-vacio').classList.toggle('oculto', modulosCache.length > 0);
  refrescarSelectoresModulo();
}

function refrescarSelectoresModulo() {
  const activos = modulosCache.filter((m) => m.activo);
  const opciones = activos.map((m) => `<option value="${m.id}">${escapar(m.bien_capital)}${m.tipo ? ' · ' + escapar(m.tipo) : ''}</option>`).join('');
  $('#parte-modulo').innerHTML = '<option value="">Elegí el módulo…</option>' + opciones;
  $('#material-modulo').innerHTML = '<option value="">Sin asignar</option>' + opciones;
  $('#documento-modulo').innerHTML = '<option value="">Sin asignar</option>' + opciones;
  const anteriorMat = $('#filtro-material-modulo').value;
  const anteriorDoc = $('#filtro-doc-modulo').value;
  $('#filtro-material-modulo').innerHTML = '<option value="">Todos</option>' + opciones;
  $('#filtro-doc-modulo').innerHTML = '<option value="">Todos</option>' + opciones;
  $('#filtro-material-modulo').value = anteriorMat;
  $('#filtro-doc-modulo').value = anteriorDoc;
}

$('#ver-modulos-baja').addEventListener('change', cargarModulos);

$('#btn-nuevo-modulo').addEventListener('click', () => abrirModalModulo(null));

function abrirModalModulo(modulo) {
  $('#modal-modulo-titulo').textContent = modulo ? 'Editar módulo' : 'Agregar módulo';
  $('#modulo-id').value = modulo ? modulo.id : '';
  $('#modulo-bien').value = modulo ? modulo.bien_capital : '';
  $('#modulo-tipo').value = modulo ? (modulo.tipo || '') : '';
  $('#modulo-cliente').value = modulo ? (modulo.cliente || '') : '';
  $('#modulo-ubicacion').value = modulo ? (modulo.ubicacion || '') : '';
  $('#modulo-largo').value = modulo && modulo.largo != null ? modulo.largo : '';
  $('#modulo-ancho').value = modulo && modulo.ancho != null ? modulo.ancho : '';
  $('#modulo-alto').value = modulo && modulo.alto != null ? modulo.alto : '';
  $('#modulo-estado').value = modulo ? modulo.estado : 'Pendiente';
  $('#modulo-objetivo').value = modulo ? (modulo.fecha_objetivo || '') : '';
  $('#modulo-notas').value = modulo ? (modulo.notas || '') : '';
  $('#modulo-error').classList.add('oculto');
  $('#modal-modulo').showModal();
}

$('#form-modulo').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#modulo-error').classList.add('oculto');
  const id = $('#modulo-id').value;
  const cuerpo = {
    bien_capital: $('#modulo-bien').value.trim(),
    tipo: $('#modulo-tipo').value.trim(),
    cliente: $('#modulo-cliente').value.trim(),
    ubicacion: $('#modulo-ubicacion').value.trim(),
    largo: $('#modulo-largo').value,
    ancho: $('#modulo-ancho').value,
    alto: $('#modulo-alto').value,
    estado: $('#modulo-estado').value,
    fecha_objetivo: $('#modulo-objetivo').value,
    notas: $('#modulo-notas').value.trim()
  };
  try {
    await api(id ? `/api/modulos/${id}` : '/api/modulos', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    });
    $('#modal-modulo').close();
    aviso(id ? 'Módulo actualizado' : 'Módulo agregado');
    await cargarModulos();
    if (detalleModuloId && String(detalleModuloId) === String(id)) abrirDetalle(id);
  } catch (err) {
    mostrarError('#modulo-error', err.message);
  }
});

$('#tabla-modulos').addEventListener('click', async (e) => {
  const ver = e.target.closest('[data-ver]');
  const editar = e.target.closest('[data-editar]');
  const baja = e.target.closest('[data-baja]');
  if (ver) abrirDetalle(ver.dataset.ver);
  if (editar) {
    const modulo = modulosCache.find((m) => String(m.id) === editar.dataset.editar);
    if (modulo) abrirModalModulo(modulo);
  }
  if (baja) {
    const activo = baja.dataset.activo === '1';
    const modulo = modulosCache.find((m) => String(m.id) === baja.dataset.baja);
    const texto = activo
      ? `¿Dar de baja el módulo ${modulo.bien_capital}? Deja de aparecer en el listado pero se conserva todo su historial.`
      : `¿Reactivar el módulo ${modulo.bien_capital}?`;
    if (!confirm(texto)) return;
    await api(`/api/modulos/${baja.dataset.baja}/activo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: !activo })
    });
    aviso(activo ? 'Módulo dado de baja' : 'Módulo reactivado');
    cargarModulos();
  }
});

// ---------- Ficha del módulo ----------
async function abrirDetalle(id) {
  detalleModuloId = id;
  const m = await api(`/api/modulos/${id}`);
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('activo', b.dataset.seccion === 'inventario'));
  mostrarSeccion('seccion-modulo-detalle');
  $('#detalle-titulo').textContent = `Módulo ${m.bien_capital}`;

  $('#detalle-datos').innerHTML = `
    <dt>Bien de capital</dt><dd>${escapar(m.bien_capital)}</dd>
    <dt>Tipo</dt><dd>${escapar(m.tipo || '–')}</dd>
    <dt>Medidas</dt><dd>${medidasTexto(m)}</dd>
    <dt>Cliente</dt><dd>${escapar(m.cliente || '–')}</dd>
    <dt>Ubicación</dt><dd>${escapar(m.ubicacion || '–')}</dd>
    <dt>Estado</dt><dd>${etiquetaEstado(m.estado)}</dd>
    <dt>Fecha objetivo</dt><dd>${m.fecha_objetivo ? formatearFecha(m.fecha_objetivo) : '–'}</dd>
    <dt>Observaciones</dt><dd>${escapar(m.notas || '–')}</dd>
  `;
  $('#detalle-barra').innerHTML = barraAvance(m.avance, m.id, false);

  $('#detalle-galeria').innerHTML = m.fotos.map((f) => `
    <figure class="galeria-item">
      <img src="/uploads/${encodeURIComponent(f.archivo)}" data-foto="${escapar(f.archivo)}" alt="${escapar(f.descripcion || 'Foto del módulo')}">
      <figcaption>${escapar(f.descripcion || '')}<button class="btn-borrar-foto" data-borrar-foto="${f.id}" title="Borrar foto">×</button></figcaption>
    </figure>
  `).join('');
  $('#detalle-sin-fotos').classList.toggle('oculto', m.fotos.length > 0);

  $('#detalle-historial').innerHTML = m.partes.length
    ? m.partes.map((p) => tarjetaParte(p, false)).join('')
    : '<p class="texto-vacio">Todavía no se cargó ninguna jornada de trabajo para este módulo.</p>';

  $('#tabla-detalle-materiales tbody').innerHTML = m.materiales.map((mat) => `
    <tr>
      <td>${formatearFecha(mat.fecha)}</td>
      <td>${escapar(mat.descripcion)}</td>
      <td class="num">${mat.cantidad != null ? Number(mat.cantidad).toLocaleString('es-AR') + (mat.unidad ? ' ' + escapar(mat.unidad) : '') : '–'}</td>
      <td>${etiquetaEstado(mat.estado)}</td>
    </tr>
  `).join('');
  $('#detalle-sin-materiales').classList.toggle('oculto', m.materiales.length > 0);

  $('#tabla-detalle-docs tbody').innerHTML = m.documentos.map((d) => `
    <tr>
      <td>${escapar(d.tipo)}</td>
      <td>${escapar(d.titulo || '–')}</td>
      <td>${celdaArchivo(d.archivo)}</td>
    </tr>
  `).join('');
  $('#detalle-sin-docs').classList.toggle('oculto', m.documentos.length > 0);
}

$('#btn-detalle-volver').addEventListener('click', () => { detalleModuloId = null; irASeccion('inventario'); });
$('#btn-detalle-editar').addEventListener('click', () => {
  const modulo = modulosCache.find((m) => String(m.id) === String(detalleModuloId));
  if (modulo) abrirModalModulo(modulo);
});
$('#btn-detalle-fotos').addEventListener('click', () => {
  $('#fotos-modulo-id').value = detalleModuloId;
  $('#form-fotos').reset();
  $('#fotos-error').classList.add('oculto');
  $('#modal-fotos').showModal();
});

$('#detalle-galeria').addEventListener('click', async (e) => {
  const borrar = e.target.closest('[data-borrar-foto]');
  if (!borrar) return;
  e.stopPropagation();
  if (!confirm('¿Borrar esta foto?')) return;
  await api(`/api/modulo-fotos/${borrar.dataset.borrarFoto}`, { method: 'DELETE' });
  aviso('Foto borrada');
  abrirDetalle(detalleModuloId);
});

$('#form-fotos').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#fotos-error').classList.add('oculto');
  const archivos = $('#fotos-archivos').files;
  if (!archivos.length) return mostrarError('#fotos-error', 'Elegí al menos una foto');
  const datos = new FormData();
  for (const f of archivos) datos.append('fotos', f);
  datos.append('descripcion', $('#fotos-descripcion').value.trim());
  try {
    const r = await api(`/api/modulos/${$('#fotos-modulo-id').value}/fotos`, { method: 'POST', body: datos });
    $('#modal-fotos').close();
    aviso(r.cantidad === 1 ? 'Foto agregada' : `${r.cantidad} fotos agregadas`);
    abrirDetalle($('#fotos-modulo-id').value);
  } catch (err) {
    mostrarError('#fotos-error', err.message);
  }
});

function celdaArchivo(archivo) {
  if (!archivo) return '<span class="sin-foto">–</span>';
  return archivo.toLowerCase().endsWith('.pdf')
    ? `<a class="link-pdf" href="/uploads/${encodeURIComponent(archivo)}" target="_blank" rel="noopener">Ver PDF</a>`
    : `<img class="miniatura" src="/uploads/${encodeURIComponent(archivo)}" data-foto="${escapar(archivo)}" alt="Archivo">`;
}

// ---------- Seguimiento de reparación ----------
function tarjetaParte(p, conBorrar) {
  const fotos = (p.fotos || []).map((f) => `<img class="miniatura" src="/uploads/${encodeURIComponent(f.archivo)}" data-foto="${escapar(f.archivo)}" alt="Foto del trabajo">`).join('');
  return `
    <article class="parte">
      <div class="parte-cabecera">
        <div>
          <strong>${escapar(p.bien_capital || '')}</strong>
          <span class="parte-fecha">${formatearFecha(p.fecha)}</span>
        </div>
        <div class="parte-cabecera-derecha">
          ${p.avance != null ? `<span class="etiqueta etiqueta-alerta">${p.avance}% de avance</span>` : ''}
          ${conBorrar ? `<button class="btn btn-chico btn-peligro" data-borrar-parte="${p.id}">Borrar</button>` : ''}
        </div>
      </div>
      <p class="parte-actividades">${escapar(p.actividades)}</p>
      ${p.responsable ? `<p class="parte-dato"><span>Responsable:</span> ${escapar(p.responsable)}</p>` : ''}
      ${p.notas ? `<p class="parte-dato"><span>Observaciones:</span> ${escapar(p.notas)}</p>` : ''}
      ${fotos ? `<div class="parte-fotos">${fotos}</div>` : ''}
    </article>
  `;
}

async function cargarPartes() {
  const fecha = $('#filtro-parte-fecha').value;
  const datos = await api('/api/partes' + (fecha ? `?fecha=${fecha}` : ''));
  hoyServidor = datos.hoy;
  const partes = datos.partes;
  $('#lista-partes').innerHTML = partes.map((p) => tarjetaParte(p, true)).join('');
  $('#partes-vacio').classList.toggle('oculto', partes.length > 0);
  const modulosTrabajados = new Set(partes.map((p) => p.modulo_id)).size;
  $('#parte-resumen').textContent = partes.length
    ? `${partes.length} ${partes.length === 1 ? 'registro' : 'registros'} · ${modulosTrabajados} ${modulosTrabajados === 1 ? 'módulo' : 'módulos'}`
    : '';
  await dibujarAvances('#avances-modulos', true);
}

$('#filtro-parte-fecha').addEventListener('change', cargarPartes);
$('#btn-parte-hoy').addEventListener('click', () => {
  $('#filtro-parte-fecha').value = hoyServidor || fechaISOArgentina();
  cargarPartes();
});

$('#lista-partes').addEventListener('click', async (e) => {
  const borrar = e.target.closest('[data-borrar-parte]');
  if (!borrar) return;
  if (!confirm('¿Borrar este registro de trabajo? También se borran sus fotos.')) return;
  await api(`/api/partes/${borrar.dataset.borrarParte}`, { method: 'DELETE' });
  aviso('Registro borrado');
  cargarPartes();
});

$('#btn-nuevo-parte').addEventListener('click', () => {
  if (!modulosCache.filter((m) => m.activo).length) {
    return aviso('Primero cargá al menos un módulo en el inventario');
  }
  $('#form-parte').reset();
  $('#parte-fecha').value = $('#filtro-parte-fecha').value || hoyServidor || fechaISOArgentina();
  $('#parte-avance').value = 0;
  $('#parte-avance-valor').textContent = '0%';
  $('#parte-error').classList.add('oculto');
  $('#modal-parte').showModal();
});

// Al elegir el módulo, la barra arranca en el avance que ya tiene
$('#parte-modulo').addEventListener('change', () => {
  const modulo = modulosCache.find((m) => String(m.id) === $('#parte-modulo').value);
  const valor = modulo ? modulo.avance : 0;
  $('#parte-avance').value = valor;
  $('#parte-avance-valor').textContent = valor + '%';
});

$('#parte-avance').addEventListener('input', (e) => {
  $('#parte-avance-valor').textContent = e.target.value + '%';
});

$('#form-parte').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#parte-error').classList.add('oculto');
  const datos = new FormData();
  datos.append('fecha', $('#parte-fecha').value);
  datos.append('modulo_id', $('#parte-modulo').value);
  datos.append('actividades', $('#parte-actividades').value.trim());
  datos.append('responsable', $('#parte-responsable').value.trim());
  datos.append('avance', $('#parte-avance').value);
  datos.append('notas', $('#parte-notas').value.trim());
  for (const f of $('#parte-fotos').files) datos.append('fotos', f);
  try {
    await api('/api/partes', { method: 'POST', body: datos });
    $('#modal-parte').close();
    aviso('Trabajo del día guardado');
    $('#filtro-parte-fecha').value = $('#parte-fecha').value;
    await cargarModulos();
    cargarPartes();
  } catch (err) {
    mostrarError('#parte-error', err.message);
  }
});

// Barras de avance por módulo (se usan en Seguimiento y en Cronograma)
async function dibujarAvances(selector, editable) {
  const resumen = await api('/api/modulos/resumen');
  const caja = $(selector);
  if (!resumen.modulos.length) {
    caja.innerHTML = '<p class="texto-vacio">No hay módulos activos.</p>';
    return resumen;
  }
  caja.innerHTML = resumen.modulos.map((m) => `
    <div class="avance-fila">
      <span class="avance-nombre">${escapar(m.bien_capital)}${m.tipo ? `<small>${escapar(m.tipo)}</small>` : ''}</span>
      ${barraAvance(m.avance, m.id, editable)}
    </div>
  `).join('');
  return resumen;
}

// Corregir el avance a mano desde cualquier barra editable
document.addEventListener('change', async (e) => {
  const rango = e.target.closest('[data-avance-modulo]');
  if (!rango) return;
  try {
    await api(`/api/modulos/${rango.dataset.avanceModulo}/avance`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avance: rango.value })
    });
    aviso('Avance actualizado');
    await cargarModulos();
    if (!$('#seccion-reparaciones').classList.contains('oculto')) await dibujarAvances('#avances-modulos', true);
    if (!$('#seccion-cronograma').classList.contains('oculto')) await cargarCronograma();
  } catch (err) {
    aviso(err.message);
  }
});

document.addEventListener('input', (e) => {
  const rango = e.target.closest('[data-avance-modulo]');
  if (!rango) return;
  const num = rango.parentElement.querySelector('.barra-num');
  if (num) num.textContent = rango.value + '%';
});

// ---------- Cronograma ----------
async function cargarCronograma() {
  const resumen = await dibujarAvances('#cronograma-avances', false);
  $('#avance-general-num').textContent = resumen.avance_total + '%';
  $('#avance-general-barra').innerHTML = `<span class="barra-pista barra-grande"><span class="barra-relleno" style="width:${resumen.avance_total}%"></span></span>`;
  $('#avance-general-detalle').textContent = resumen.cantidad
    ? `Promedio sobre ${resumen.cantidad} ${resumen.cantidad === 1 ? 'módulo activo' : 'módulos activos'}`
    : 'Todavía no hay módulos cargados';
  await dibujarCalendario();
}

async function dibujarCalendario() {
  const datos = await api(`/api/partes/calendario?mes=${mesCronograma}`);
  hoyServidor = datos.hoy;
  $('#cal-titulo').textContent = nombreMes(mesCronograma);

  const porDia = new Map(datos.dias.map((d) => [d.fecha, d]));
  const objetivos = new Map();
  datos.objetivos.forEach((o) => {
    if (!objetivos.has(o.fecha)) objetivos.set(o.fecha, []);
    objetivos.get(o.fecha).push(o.bien_capital);
  });

  const [anio, mes] = mesCronograma.split('-').map(Number);
  const primero = new Date(anio, mes - 1, 1);
  const diasEnMes = new Date(anio, mes, 0).getDate();
  // La semana arranca el lunes: getDay() devuelve 0 para domingo
  const desplazamiento = (primero.getDay() + 6) % 7;

  let html = '';
  for (let i = 0; i < desplazamiento; i++) html += '<div class="cal-dia cal-vacio"></div>';
  for (let dia = 1; dia <= diasEnMes; dia++) {
    const iso = `${mesCronograma}-${String(dia).padStart(2, '0')}`;
    const trabajo = porDia.get(iso);
    const objetivo = objetivos.get(iso);
    const clases = ['cal-dia'];
    if (iso === hoyServidor) clases.push('cal-hoy');
    if (trabajo) clases.push('cal-con-trabajo');
    if (objetivo) clases.push('cal-con-objetivo');
    html += `
      <div class="${clases.join(' ')}" data-dia="${iso}">
        <span class="cal-numero">${dia}</span>
        ${trabajo ? `<span class="cal-marca">${trabajo.modulos} ${trabajo.modulos === 1 ? 'módulo' : 'módulos'}</span>` : ''}
        ${objetivo ? `<span class="cal-objetivo" title="Entrega objetivo: ${escapar(objetivo.join(', '))}">Entrega: ${escapar(objetivo.join(', '))}</span>` : ''}
      </div>`;
  }
  $('#cal-dias').innerHTML = html;
}

$('#cal-anterior').addEventListener('click', () => { mesCronograma = mesVecino(mesCronograma, -1); cargarCronograma(); });
$('#cal-siguiente').addEventListener('click', () => { mesCronograma = mesVecino(mesCronograma, 1); cargarCronograma(); });

function mesVecino(mesISO, delta) {
  const [a, m] = mesISO.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Click en un día del calendario: lleva al seguimiento de esa fecha
$('#cal-dias').addEventListener('click', (e) => {
  const dia = e.target.closest('[data-dia]');
  if (!dia) return;
  $('#filtro-parte-fecha').value = dia.dataset.dia;
  irASeccion('reparaciones');
});

// ---------- Materiales ----------
let materialesCache = [];

async function cargarMateriales() {
  const filtro = $('#filtro-material-modulo').value;
  const parametros = new URLSearchParams();
  if (filtro) parametros.set('modulo_id', filtro);
  if ($('#ver-materiales-baja').checked) parametros.set('inactivos', '1');
  const consulta = parametros.toString();
  materialesCache = await api('/api/materiales' + (consulta ? `?${consulta}` : ''));
  $('#tabla-materiales tbody').innerHTML = materialesCache.map((m) => `
    <tr>
      <td>${formatearFecha(m.fecha)}${m.activo ? '' : ' <span class="etiqueta etiqueta-baja">BAJA</span>'}</td>
      <td>${escapar(m.bien_capital || 'Sin asignar')}</td>
      <td>${escapar(m.descripcion)}${m.notas ? `<small class="celda-nota">${escapar(m.notas)}</small>` : ''}</td>
      <td class="num">${m.cantidad != null ? Number(m.cantidad).toLocaleString('es-AR') + (m.unidad ? ' ' + escapar(m.unidad) : '') : '–'}</td>
      <td>${escapar(m.proveedor || '–')}</td>
      <td>
        <select class="select-estado" data-valor="${escapar(m.estado)}" data-estado-material="${m.id}">
          ${['Pedido', 'Comprado'].map((op) => `<option ${op === m.estado ? 'selected' : ''}>${op}</option>`).join('')}
        </select>
      </td>
      <td>${celdaArchivo(m.comprobante_archivo)}</td>
      <td class="celda-acciones">
        <button class="btn btn-chico" data-editar-material="${m.id}">Editar</button>
        <button class="btn btn-chico ${m.activo ? 'btn-peligro' : ''}" data-baja-material="${m.id}" data-activo="${m.activo}">${m.activo ? 'Dar de baja' : 'Reactivar'}</button>
      </td>
    </tr>
  `).join('');
  $('#materiales-vacio').classList.toggle('oculto', materialesCache.length > 0);
  pintarResumenMateriales();
}

function pintarResumenMateriales() {
  const activos = materialesCache.filter((m) => m.activo);
  const porEstado = ['Pedido', 'Comprado']
    .map((e) => `${activos.filter((m) => m.estado === e).length} ${e.toLowerCase()}`)
    .join(' · ');
  $('#material-resumen').textContent = materialesCache.length ? porEstado : '';
}

$('#filtro-material-modulo').addEventListener('change', cargarMateriales);
$('#ver-materiales-baja').addEventListener('change', cargarMateriales);

function abrirModalMaterial(material) {
  $('#modal-material-titulo').textContent = material ? 'Editar material' : 'Agregar material';
  $('#material-id').value = material ? material.id : '';
  $('#material-fecha').value = material ? material.fecha : (hoyServidor || fechaISOArgentina());
  $('#material-modulo').value = material ? (material.modulo_id || '') : ($('#filtro-material-modulo').value || '');
  $('#material-descripcion').value = material ? material.descripcion : '';
  $('#material-cantidad').value = material && material.cantidad != null ? material.cantidad : '';
  $('#material-unidad').value = material ? (material.unidad || '') : '';
  $('#material-estado').value = material ? material.estado : 'Pedido';
  $('#material-proveedor').value = material ? (material.proveedor || '') : '';
  $('#material-notas').value = material ? (material.notas || '') : '';
  $('#material-comprobante').value = '';
  $('#material-quitar-comprobante').checked = false;
  $('#material-quitar-comprobante-caja').classList.toggle('oculto', !(material && material.comprobante_archivo));
  $('#material-error').classList.add('oculto');
  $('#modal-material').showModal();
}

$('#btn-nuevo-material').addEventListener('click', () => abrirModalMaterial(null));

$('#form-material').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#material-error').classList.add('oculto');
  const id = $('#material-id').value;
  const datos = new FormData();
  datos.append('fecha', $('#material-fecha').value);
  datos.append('modulo_id', $('#material-modulo').value);
  datos.append('descripcion', $('#material-descripcion').value.trim());
  datos.append('cantidad', $('#material-cantidad').value);
  datos.append('unidad', $('#material-unidad').value.trim());
  datos.append('estado', $('#material-estado').value);
  datos.append('proveedor', $('#material-proveedor').value.trim());
  datos.append('notas', $('#material-notas').value.trim());
  if ($('#material-quitar-comprobante').checked) datos.append('quitar_comprobante', '1');
  if ($('#material-comprobante').files[0]) datos.append('comprobante', $('#material-comprobante').files[0]);
  try {
    await api(id ? `/api/materiales/${id}` : '/api/materiales', { method: id ? 'PUT' : 'POST', body: datos });
    $('#modal-material').close();
    aviso(id ? 'Material actualizado' : 'Material guardado');
    cargarMateriales();
  } catch (err) {
    mostrarError('#material-error', err.message);
  }
});

$('#tabla-materiales').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-estado-material]');
  if (!sel) return;
  await api(`/api/materiales/${sel.dataset.estadoMaterial}/estado`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: sel.value })
  });
  sel.dataset.valor = sel.value; // repinta el color sin recargar la tabla
  const material = materialesCache.find((m) => String(m.id) === sel.dataset.estadoMaterial);
  if (material) { material.estado = sel.value; pintarResumenMateriales(); }
  aviso('Estado actualizado');
});

$('#tabla-materiales').addEventListener('click', async (e) => {
  const editar = e.target.closest('[data-editar-material]');
  const baja = e.target.closest('[data-baja-material]');
  if (editar) {
    const material = materialesCache.find((m) => String(m.id) === editar.dataset.editarMaterial);
    if (material) abrirModalMaterial(material);
  }
  if (baja) {
    const activo = baja.dataset.activo === '1';
    const material = materialesCache.find((m) => String(m.id) === baja.dataset.bajaMaterial);
    const texto = activo
      ? `¿Dar de baja "${material.descripcion}"? Deja de aparecer en el listado pero queda el registro.`
      : `¿Reactivar "${material.descripcion}"?`;
    if (!confirm(texto)) return;
    await api(`/api/materiales/${baja.dataset.bajaMaterial}/activo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: !activo })
    });
    aviso(activo ? 'Material dado de baja' : 'Material reactivado');
    cargarMateriales();
  }
});

// ---------- Documentación ----------
async function cargarDocumentos() {
  const filtro = $('#filtro-doc-modulo').value;
  const filas = await api('/api/documentos-modulo' + (filtro ? `?modulo_id=${filtro}` : ''));
  $('#tabla-documentos tbody').innerHTML = filas.map((d) => `
    <tr>
      <td><span class="etiqueta etiqueta-categoria">${escapar(d.tipo)}</span></td>
      <td>${escapar(d.titulo || '–')}</td>
      <td>${escapar(d.bien_capital || 'Sin asignar')}</td>
      <td>${celdaArchivo(d.archivo)}</td>
      <td>${escapar(d.notas || '–')}</td>
      <td class="celda-acciones"><button class="btn btn-chico btn-peligro" data-borrar-doc="${d.id}">Borrar</button></td>
    </tr>
  `).join('');
  $('#documentos-vacio').classList.toggle('oculto', filas.length > 0);
  $('#doc-resumen').textContent = filas.length ? `${filas.length} ${filas.length === 1 ? 'documento' : 'documentos'}` : '';
}

$('#filtro-doc-modulo').addEventListener('change', cargarDocumentos);

$('#btn-nuevo-documento').addEventListener('click', () => {
  $('#form-documento').reset();
  $('#documento-modulo').value = $('#filtro-doc-modulo').value || '';
  $('#documento-error').classList.add('oculto');
  $('#modal-documento').showModal();
});

$('#form-documento').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#documento-error').classList.add('oculto');
  const archivo = $('#documento-archivo').files[0];
  if (!archivo) return mostrarError('#documento-error', 'Adjuntá el archivo');
  const datos = new FormData();
  datos.append('tipo', $('#documento-tipo').value.trim());
  datos.append('titulo', $('#documento-titulo').value.trim());
  datos.append('modulo_id', $('#documento-modulo').value);
  datos.append('notas', $('#documento-notas').value.trim());
  datos.append('archivo', archivo);
  try {
    await api('/api/documentos-modulo', { method: 'POST', body: datos });
    $('#modal-documento').close();
    aviso('Documento guardado');
    cargarDocumentos();
  } catch (err) {
    mostrarError('#documento-error', err.message);
  }
});

$('#tabla-documentos').addEventListener('click', async (e) => {
  const borrar = e.target.closest('[data-borrar-doc]');
  if (!borrar) return;
  if (!confirm('¿Borrar este documento?')) return;
  await api(`/api/documentos-modulo/${borrar.dataset.borrarDoc}`, { method: 'DELETE' });
  aviso('Documento borrado');
  cargarDocumentos();
});

verificarSesion();
