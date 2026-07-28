/* MAMUTS · Sistema de Gestión — lógica de la interfaz */

const $ = (sel) => document.querySelector(sel);

const TZ_ARGENTINA = 'America/Argentina/Buenos_Aires';

let vehiculosCache = [];
let opcionesVehiculos = [];
let contactosCache = [];
let usuariosCache = [];
let permisosCatalogo = null;
let detalleVehiculoId = null;

// ---------- Permisos (estado global) ----------
window.PERMISOS = new Set();
window.ES_ADMIN = false;
function puede(clave) { return window.ES_ADMIN || window.PERMISOS.has(clave); }

// ---------- Utilidades ----------
async function api(url, opciones = {}) {
  const res = await fetch(url, opciones);
  let datos = null;
  try { datos = await res.json(); } catch { /* respuesta sin JSON */ }
  if (res.status === 401 && !url.includes('/api/login')) {
    mostrarLogin();
    throw new Error('Sesión vencida');
  }
  if (!res.ok) throw new Error((datos && datos.error) || 'Error inesperado del servidor');
  return datos;
}

// Los que no son de la empresa se destacan para no confundirlos con la flota propia
function etiquetaPropiedad(propiedad) {
  const valor = propiedad || 'Propio';
  const clase = {
    'Alquilado': 'etiqueta-alerta',
    'Particular': 'etiqueta-baja'
  }[valor] || 'etiqueta-categoria';
  return `<span class="etiqueta ${clase}">${escapar(valor)}</span>`;
}

function formatearLitros(n) {
  return Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 }) + ' L';
}

const formatoDinero = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
function formatearDinero(n) { return formatoDinero.format(Number(n || 0)); }

// Interpreta montos escritos a la argentina: "150.000", "1.250.000,50", "150000"
function parsearMontoAR(texto) {
  let s = String(texto == null ? '' : texto).trim().replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    const partes = s.split('.');
    const decimalClaro = partes.length === 2 && partes[1].length <= 2 && partes[0].length <= 3;
    if (!decimalClaro) s = s.replace(/\./g, '');
  }
  return parseFloat(s);
}

function formatearFecha(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function fechaISOArgentina() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ_ARGENTINA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function mesActualArgentina() { return fechaISOArgentina().slice(0, 7); }

function nombreMes(mesISO) {
  const [a, m] = mesISO.split('-').map(Number);
  const texto = new Date(a, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function escapar(texto) {
  // Escapa también comillas: seguro en contenido HTML y dentro de atributos
  return String(texto == null ? '' : texto)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

function celdaComprobante(archivo) {
  if (!archivo) return '<span class="sin-foto">–</span>';
  return archivo.toLowerCase().endsWith('.pdf')
    ? `<a class="link-pdf" href="/uploads/${encodeURIComponent(archivo)}" target="_blank" rel="noopener">Ver PDF</a>`
    : `<img class="miniatura" src="/uploads/${encodeURIComponent(archivo)}" data-foto="${escapar(archivo)}" alt="Comprobante">`;
}

document.addEventListener('click', (e) => {
  const mini = e.target.closest('[data-foto]');
  if (mini) {
    $('#foto-grande').src = '/uploads/' + encodeURIComponent(mini.dataset.foto);
    $('#modal-foto').showModal();
  }
});

// ---------- Reloj de Argentina ----------
function actualizarReloj() {
  const ahora = new Date();
  const fecha = new Intl.DateTimeFormat('es-AR', { timeZone: TZ_ARGENTINA, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(ahora);
  const hora = new Intl.DateTimeFormat('es-AR', { timeZone: TZ_ARGENTINA, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(ahora);
  if ($('#reloj-fecha')) $('#reloj-fecha').textContent = 'Hoy es ' + fecha.charAt(0).toUpperCase() + fecha.slice(1);
  if ($('#reloj-hora')) $('#reloj-hora').textContent = hora + ' hs (Argentina)';
}

// ---------- Sesión ----------
function mostrarLogin() {
  $('#app').classList.add('oculto');
  $('#pantalla-login').classList.remove('oculto');
  $('#login-usuario').focus();
}

function aplicarPermisos() {
  document.querySelectorAll('[data-perm]').forEach((el) => el.classList.toggle('oculto', !puede(el.dataset.perm)));
  document.querySelectorAll('[data-perm-any]').forEach((el) => {
    const ok = el.dataset.permAny.split(',').some((c) => puede(c.trim()));
    el.classList.toggle('oculto', !ok);
  });
  document.querySelectorAll('[data-solo-admin]').forEach((el) => el.classList.toggle('oculto', !window.ES_ADMIN));
  document.body.classList.toggle('sin-consumo', !puede('ver_consumo_vehiculo'));
}

function seccionInicial() {
  const puedePanel = window.ES_ADMIN || ['ver_vehiculos', 'ver_vales', 'ver_totales_litros', 'ver_totales_gastos'].some(puede);
  if (puedePanel) return 'panel';
  if (puede('ver_vehiculos') || puede('editar_vehiculos')) return 'vehiculos';
  if (puede('cargar_vales') || puede('ver_vales')) return 'vales';
  if (puede('ver_nomina') || puede('editar_nomina')) return 'nomina';
  if (puede('ver_contactos') || puede('editar_contactos')) return 'contactos';
  if (puede('cargar_gastos') || puede('ver_gastos')) return 'finanzas';
  return 'config';
}

let relojIniciado = false;
async function iniciarSesion() {
  const me = await api('/api/me');
  window.ES_ADMIN = !!me.es_admin;
  window.PERMISOS = new Set(me.permisos || []);
  $('#pantalla-login').classList.add('oculto');
  $('#app').classList.remove('oculto');
  $('#usuario-actual').textContent = me.username;
  aplicarPermisos();
  if (!relojIniciado) { actualizarReloj(); setInterval(actualizarReloj, 1000); relojIniciado = true; }
  if (puede('cargar_vales') || puede('cargar_gastos') || puede('ver_vehiculos')) cargarOpcionesVehiculos();
  if (puede('cargar_vales') || puede('editar_vehiculos') || puede('ver_nomina')) cargarOpcionesEmpleados();
  irASeccion(seccionInicial());
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').classList.add('oculto');
  try {
    await api('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('#login-usuario').value.trim(), password: $('#login-password').value })
    });
    $('#login-password').value = '';
    await iniciarSesion();
  } catch (err) {
    mostrarError('#login-error', err.message);
  }
});

$('#btn-salir').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  mostrarLogin();
});

// ---------- Navegación ----------
function mostrarSeccion(id) {
  document.querySelectorAll('.seccion').forEach((s) => s.classList.add('oculto'));
  $(`#${id}`).classList.remove('oculto');
}

function irASeccion(nombre) {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('activo', b.dataset.seccion === nombre));
  mostrarSeccion(`seccion-${nombre}`);
  if (nombre === 'panel') cargarPanel();
  if (nombre === 'vehiculos') cargarVehiculos();
  if (nombre === 'vales') cargarVales();
  if (nombre === 'nomina') cargarNomina();
  if (nombre === 'contactos') cargarContactos();
  if (nombre === 'finanzas') cargarFinanzas();
  if (nombre === 'usuarios') cargarUsuarios();
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => irASeccion(btn.dataset.seccion));
});

document.querySelectorAll('dialog [data-cerrar]').forEach((btn) => {
  btn.addEventListener('click', () => btn.closest('dialog').close());
});

// ---------- Panel ----------
async function cargarPanel() {
  const d = await api('/api/dashboard');
  if ('vehiculos_activos' in d) $('#stat-vehiculos').textContent = d.vehiculos_activos;
  if ('vales_mes' in d) $('#stat-vales-mes').textContent = d.vales_mes;
  if ('litros_mes' in d) $('#stat-litros-mes').textContent = formatearLitros(d.litros_mes);
  if ('gasto_mes' in d) $('#stat-gasto-mes').textContent = formatearDinero(d.gasto_mes);

  if (d.ultimos_vales) {
    $('#tabla-ultimos-vales tbody').innerHTML = d.ultimos_vales.length
      ? d.ultimos_vales.map((v) => `<tr><td>${formatearFecha(v.fecha)}</td><td>${escapar(v.marca)} ${escapar(v.modelo)} · ${escapar(v.patente)}</td><td class="num">${formatearLitros(v.litros)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="texto-vacio">Sin vales todavía</td></tr>';
  }
  if (d.top_vehiculos_mes) {
    $('#tabla-top-vehiculos tbody').innerHTML = d.top_vehiculos_mes.length
      ? d.top_vehiculos_mes.map((v) => `<tr><td>${escapar(v.marca)} ${escapar(v.modelo)} · ${escapar(v.patente)}</td><td class="num">${formatearLitros(v.litros)}</td></tr>`).join('')
      : '<tr><td colspan="2" class="texto-vacio">Sin consumo este mes</td></tr>';
  }
  const algo = window.ES_ADMIN || ['ver_vehiculos', 'ver_vales', 'ver_totales_litros', 'ver_totales_gastos'].some(puede);
  $('#panel-vacio').classList.toggle('oculto', algo);
}

// ---------- Selectores de vehículo (para vales y gastos) ----------
function pintarSelectoresVehiculo() {
  const opciones = opcionesVehiculos.map((v) => `<option value="${v.id}">${escapar(v.patente)} — ${escapar(v.marca)} ${escapar(v.modelo)}</option>`).join('');
  if ($('#vale-vehiculo')) $('#vale-vehiculo').innerHTML = '<option value="">Elegir vehículo…</option>' + opciones;
  if ($('#gasto-vehiculo')) $('#gasto-vehiculo').innerHTML = '<option value="">Ninguno</option>' + opciones;
  if ($('#filtro-vehiculo')) {
    const cur = $('#filtro-vehiculo').value;
    $('#filtro-vehiculo').innerHTML = '<option value="">Todos</option>' + opciones;
    $('#filtro-vehiculo').value = cur;
  }
}
async function cargarOpcionesVehiculos() {
  try { opcionesVehiculos = await api('/api/vehiculos/opciones'); pintarSelectoresVehiculo(); } catch { /* sin permiso */ }
}

// ---------- Vehículos ----------
async function cargarVehiculos() {
  const todos = $('#ver-inactivos').checked;
  const filas = await api(`/api/vehiculos${todos ? '?todos=1' : ''}`);
  vehiculosCache = filas;
  opcionesVehiculos = filas.filter((v) => v.activo).map((v) => ({ id: v.id, patente: v.patente, marca: v.marca, modelo: v.modelo }));
  pintarSelectoresVehiculo();

  $('#vehiculos-vacio').classList.toggle('oculto', filas.length > 0);
  $('#tabla-vehiculos tbody').innerHTML = filas.map((v) => `
    <tr>
      <td><strong>${escapar(v.patente)}</strong>${v.activo ? '' : ' <span class="etiqueta etiqueta-baja">BAJA</span>'}</td>
      <td>${escapar(v.marca)}</td>
      <td>${escapar(v.modelo)}</td>
      <td>${v.anio || ''}</td>
      <td>${escapar(v.tipo_combustible)}</td>
      <td>${etiquetaPropiedad(v.propiedad)}</td>
      <td>${escapar(v.chofer || '')}</td>
      <td class="num col-consumo">${v.cant_vales == null ? '' : v.cant_vales}</td>
      <td class="num col-consumo">${v.total_litros == null ? '' : formatearLitros(v.total_litros)}</td>
      <td class="num celda-acciones">
        <button class="btn btn-chico btn-primario" data-ver="${v.id}">Ver</button>
        ${puede('editar_vehiculos') ? `<button class="btn btn-chico" data-editar="${v.id}">Editar</button>
        <button class="btn btn-chico ${v.activo ? 'btn-peligro' : ''}" data-baja="${v.id}" data-activo="${v.activo}" title="${v.activo ? 'Dar de baja' : 'Reactivar'}">${v.activo ? 'Baja' : 'Alta'}</button>` : ''}
      </td>
    </tr>`).join('');
}

$('#ver-inactivos').addEventListener('change', cargarVehiculos);
$('#btn-nuevo-vehiculo').addEventListener('click', () => abrirModalVehiculo(null));

$('#tabla-vehiculos').addEventListener('click', async (e) => {
  const btnVer = e.target.closest('[data-ver]');
  const btnEditar = e.target.closest('[data-editar]');
  const btnBaja = e.target.closest('[data-baja]');
  if (btnVer) { abrirDetalleVehiculo(Number(btnVer.dataset.ver)); return; }
  if (btnEditar) { abrirModalVehiculo(vehiculosCache.find((x) => x.id === Number(btnEditar.dataset.editar))); }
  if (btnBaja) {
    const activo = btnBaja.dataset.activo === '1';
    const v = vehiculosCache.find((x) => x.id === Number(btnBaja.dataset.baja));
    const pregunta = activo ? `¿Dar de baja el vehículo ${v.patente}? Su historial se conserva.` : `¿Reactivar el vehículo ${v.patente}?`;
    if (!confirm(pregunta)) return;
    await api(`/api/vehiculos/${v.id}/activo`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: !activo }) });
    aviso(activo ? 'Vehículo dado de baja' : 'Vehículo reactivado');
    cargarVehiculos();
  }
});

function abrirModalVehiculo(v) {
  $('#modal-vehiculo-titulo').textContent = v ? `Editar ${v.patente}` : 'Agregar vehículo';
  $('#vehiculo-id').value = v ? v.id : '';
  $('#vehiculo-marca').value = v ? v.marca : '';
  $('#vehiculo-modelo').value = v ? v.modelo : '';
  $('#vehiculo-patente').value = v ? v.patente : '';
  $('#vehiculo-anio').value = v && v.anio ? v.anio : '';
  $('#vehiculo-combustible').value = v ? v.tipo_combustible : 'Diesel';
  $('#vehiculo-km').value = v && v.kilometraje != null ? v.kilometraje : '';
  $('#vehiculo-propiedad').value = v && v.propiedad ? v.propiedad : 'Propio';
  $('#vehiculo-chofer').value = v && v.chofer ? v.chofer : '';
  $('#vehiculo-notas').value = v && v.notas ? v.notas : '';
  $('#vehiculo-foto').value = '';
  $('#vehiculo-foto-preview').classList.add('oculto');
  $('#vehiculo-quitar-foto').checked = false;
  $('#vehiculo-quitar-foto-caja').classList.toggle('oculto', !(v && v.foto_archivo));
  $('#vehiculo-error').classList.add('oculto');
  $('#modal-vehiculo').showModal();
}

$('#vehiculo-foto').addEventListener('change', () => {
  const archivo = $('#vehiculo-foto').files[0];
  const preview = $('#vehiculo-foto-preview');
  if (archivo && archivo.type.startsWith('image/')) { preview.src = URL.createObjectURL(archivo); preview.classList.remove('oculto'); }
  else preview.classList.add('oculto');
});

$('#form-vehiculo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#vehiculo-id').value;
  const datos = new FormData();
  datos.append('marca', $('#vehiculo-marca').value);
  datos.append('modelo', $('#vehiculo-modelo').value);
  datos.append('patente', $('#vehiculo-patente').value);
  datos.append('anio', $('#vehiculo-anio').value);
  datos.append('tipo_combustible', $('#vehiculo-combustible').value);
  datos.append('kilometraje', $('#vehiculo-km').value);
  datos.append('propiedad', $('#vehiculo-propiedad').value);
  datos.append('chofer', $('#vehiculo-chofer').value);
  datos.append('notas', $('#vehiculo-notas').value);
  if ($('#vehiculo-quitar-foto').checked) datos.append('quitar_foto', '1');
  const archivo = $('#vehiculo-foto').files[0];
  if (archivo) datos.append('foto', archivo);
  try {
    await api(id ? `/api/vehiculos/${id}` : '/api/vehiculos', { method: id ? 'PUT' : 'POST', body: datos });
    $('#modal-vehiculo').close();
    aviso(id ? 'Vehículo actualizado' : 'Vehículo agregado');
    cargarVehiculos();
    if (detalleVehiculoId && id && Number(id) === detalleVehiculoId) abrirDetalleVehiculo(detalleVehiculoId);
  } catch (err) { mostrarError('#vehiculo-error', err.message); }
});

// ---------- Ficha del vehículo ----------
async function abrirDetalleVehiculo(id) {
  const d = await api(`/api/vehiculos/${id}`);
  detalleVehiculoId = id;
  const v = d.vehiculo;

  $('#detalle-titulo').textContent = `${v.patente} — ${v.marca} ${v.modelo}`;
  $('#detalle-litros-mes').textContent = d.litros_mes == null ? '–' : formatearLitros(d.litros_mes);
  $('#detalle-cant-vales').textContent = d.cant_vales == null ? '–' : d.cant_vales;
  $('#detalle-litros').textContent = d.total_litros == null ? '–' : formatearLitros(d.total_litros);

  if (v.foto_archivo) {
    $('#detalle-foto').src = '/uploads/' + encodeURIComponent(v.foto_archivo);
    $('#detalle-foto').dataset.foto = v.foto_archivo;
    $('#detalle-foto').classList.remove('oculto');
    $('#detalle-sin-foto').classList.add('oculto');
  } else {
    $('#detalle-foto').classList.add('oculto');
    $('#detalle-sin-foto').classList.remove('oculto');
  }

  const datos = [
    ['Patente', v.patente], ['Marca', v.marca], ['Modelo', v.modelo],
    ['Año', v.anio || '–'], ['Combustible', v.tipo_combustible],
    ['Propiedad', v.propiedad || 'Propio'],
    ['Kilometraje', v.kilometraje != null ? v.kilometraje.toLocaleString('es-AR') + ' km' : '–'],
    ['Chofer habitual', v.chofer || '–'], ['Estado', v.activo ? 'Activo' : 'Dado de baja'],
    ['Fecha de alta', v.creado_en ? v.creado_en.slice(0, 10).split('-').reverse().join('/') : '–'],
    ['Observaciones', v.notas || '–']
  ];
  $('#detalle-datos').innerHTML = datos.map(([k, val]) => `<div><dt>${k}</dt><dd>${escapar(val)}</dd></div>`).join('');

  $('#tecnicos-vacio').classList.toggle('oculto', d.tecnicos.length > 0);
  const puedeEditarTec = puede('editar_vehiculos');
  $('#tabla-tecnicos tbody').innerHTML = d.tecnicos.map((t) => `
    <tr>
      <td><strong>${escapar(t.tipo)}</strong></td>
      <td>${escapar(t.codigo || '')}</td>
      <td>${escapar(t.marca || '')}</td>
      <td>${escapar(t.notas || '')}</td>
      <td class="num celda-acciones">${puedeEditarTec ? `<button class="btn btn-chico" data-tec-editar="${t.id}">Editar</button>
        <button class="btn btn-chico btn-peligro" data-tec-borrar="${t.id}">Eliminar</button>` : ''}</td>
    </tr>`).join('');
  $('#tabla-tecnicos').dataset.tecnicos = JSON.stringify(d.tecnicos);

  if (d.vales) {
    $('#detalle-vales-vacio').classList.toggle('oculto', d.vales.length > 0);
    $('#tabla-detalle-vales tbody').innerHTML = d.vales.map((va) => `
      <tr><td>${formatearFecha(va.fecha)}</td><td class="num">${formatearLitros(va.litros)}</td><td>${escapar(va.numero_vale || '')}</td><td>${escapar(va.receptor || '')}</td></tr>`).join('');
  }

  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('activo', b.dataset.seccion === 'vehiculos'));
  mostrarSeccion('seccion-vehiculo-detalle');
}

$('#btn-volver-vehiculos').addEventListener('click', () => { detalleVehiculoId = null; irASeccion('vehiculos'); });
$('#btn-detalle-editar').addEventListener('click', async () => {
  const d = await api(`/api/vehiculos/${detalleVehiculoId}`);
  abrirModalVehiculo(d.vehiculo);
});
$('#btn-detalle-vales').addEventListener('click', () => { $('#filtro-vehiculo').value = String(detalleVehiculoId); irASeccion('vales'); });

$('#btn-nuevo-tecnico').addEventListener('click', () => abrirModalTecnico(null));
$('#tabla-tecnicos').addEventListener('click', async (e) => {
  const btnEditar = e.target.closest('[data-tec-editar]');
  const btnBorrar = e.target.closest('[data-tec-borrar]');
  if (btnEditar) { abrirModalTecnico(JSON.parse($('#tabla-tecnicos').dataset.tecnicos || '[]').find((t) => t.id === Number(btnEditar.dataset.tecEditar))); }
  if (btnBorrar) {
    if (!confirm('¿Eliminar este dato técnico?')) return;
    await api(`/api/tecnicos/${btnBorrar.dataset.tecBorrar}`, { method: 'DELETE' });
    aviso('Dato eliminado');
    abrirDetalleVehiculo(detalleVehiculoId);
  }
});

function abrirModalTecnico(t) {
  $('#modal-tecnico-titulo').textContent = t ? 'Editar dato técnico' : 'Agregar dato técnico';
  $('#tecnico-id').value = t ? t.id : '';
  $('#tecnico-tipo').value = t ? t.tipo : '';
  $('#tecnico-codigo').value = t && t.codigo ? t.codigo : '';
  $('#tecnico-marca').value = t && t.marca ? t.marca : '';
  $('#tecnico-notas').value = t && t.notas ? t.notas : '';
  $('#tecnico-error').classList.add('oculto');
  $('#modal-tecnico').showModal();
}

$('#form-tecnico').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#tecnico-id').value;
  const cuerpo = { tipo: $('#tecnico-tipo').value, codigo: $('#tecnico-codigo').value, marca: $('#tecnico-marca').value, notas: $('#tecnico-notas').value };
  try {
    await api(id ? `/api/tecnicos/${id}` : `/api/vehiculos/${detalleVehiculoId}/tecnicos`, { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    $('#modal-tecnico').close();
    aviso('Dato técnico guardado');
    abrirDetalleVehiculo(detalleVehiculoId);
  } catch (err) { mostrarError('#tecnico-error', err.message); }
});

// ---------- Vales ----------
async function cargarVales() {
  if (!puede('ver_vales')) { $('#tabla-vales tbody').innerHTML = ''; return; }
  const params = new URLSearchParams();
  if ($('#filtro-vehiculo').value) params.set('vehiculo', $('#filtro-vehiculo').value);
  if ($('#filtro-desde').value) params.set('desde', $('#filtro-desde').value);
  if ($('#filtro-hasta').value) params.set('hasta', $('#filtro-hasta').value);
  const filas = await api('/api/vales?' + params.toString());
  const total = filas.reduce((s, v) => s + v.litros, 0);
  $('#filtro-resumen').textContent = filas.length ? `${filas.length} vale${filas.length === 1 ? '' : 's'} · ${formatearLitros(total)}` : '';
  $('#vales-vacio').classList.toggle('oculto', filas.length > 0);
  const puedeBorrar = puede('cargar_vales');
  $('#tabla-vales tbody').innerHTML = filas.map((v) => `
    <tr>
      <td>${formatearFecha(v.fecha)}</td>
      <td>${escapar(v.marca)} ${escapar(v.modelo)} · <strong>${escapar(v.patente)}</strong></td>
      <td>${escapar([v.tipo_combustible, v.grado].filter(Boolean).join(' ') || '')}</td>
      <td class="num"><strong>${formatearLitros(v.litros)}</strong></td>
      <td class="num">${v.monto != null ? formatearDinero(v.monto) : ''}</td>
      <td>${escapar(v.numero_vale || '')}</td>
      <td>${celdaComprobante(v.foto_archivo)}</td>
      <td class="num">${puedeBorrar ? `<button class="btn btn-chico btn-peligro" data-borrar="${v.id}">Eliminar</button>` : ''}</td>
    </tr>`).join('');
}

['#filtro-vehiculo', '#filtro-desde', '#filtro-hasta'].forEach((sel) => $(sel).addEventListener('change', cargarVales));
$('#btn-limpiar-filtros').addEventListener('click', () => { $('#filtro-vehiculo').value = ''; $('#filtro-desde').value = ''; $('#filtro-hasta').value = ''; cargarVales(); });

$('#tabla-vales').addEventListener('click', async (e) => {
  const btnBorrar = e.target.closest('[data-borrar]');
  if (btnBorrar) {
    if (!confirm('¿Eliminar este vale? También se borra su comprobante.')) return;
    await api(`/api/vales/${btnBorrar.dataset.borrar}`, { method: 'DELETE' });
    aviso('Vale eliminado');
    cargarVales();
  }
});

$('#btn-nuevo-vale').addEventListener('click', async () => {
  if (!opcionesVehiculos.length) await cargarOpcionesVehiculos();
  if (!opcionesVehiculos.length) { aviso('Primero tiene que haber un vehículo cargado'); return; }
  $('#form-vale').reset();
  $('#vale-fecha').value = fechaISOArgentina();
  $('#vale-monto-hint').textContent = '';
  $('#vale-foto-preview').classList.add('oculto');
  $('#vale-error').classList.add('oculto');
  $('#modal-vale').showModal();
});

$('#vale-monto').addEventListener('input', () => {
  const hint = $('#vale-monto-hint');
  const val = $('#vale-monto').value.trim();
  if (!val) { hint.textContent = ''; hint.classList.remove('hint-error'); return; }
  const n = parsearMontoAR(val);
  if (!Number.isFinite(n) || n <= 0) { hint.textContent = 'Monto inválido'; hint.classList.add('hint-error'); }
  else { hint.textContent = '= ' + formatearDinero(n); hint.classList.remove('hint-error'); }
});

$('#vale-foto').addEventListener('change', () => {
  const archivo = $('#vale-foto').files[0];
  const preview = $('#vale-foto-preview');
  if (archivo && archivo.type.startsWith('image/')) { preview.src = URL.createObjectURL(archivo); preview.classList.remove('oculto'); }
  else preview.classList.add('oculto');
});

$('#form-vale').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-guardar-vale');
  btn.disabled = true;
  try {
    const datos = new FormData();
    datos.append('vehiculo_id', $('#vale-vehiculo').value);
    datos.append('fecha', $('#vale-fecha').value);
    datos.append('litros', $('#vale-litros').value);
    datos.append('numero_vale', $('#vale-numero').value);
    datos.append('receptor', $('#vale-receptor').value);
    datos.append('observaciones', $('#vale-observaciones').value);
    datos.append('tipo_combustible', $('#vale-tipo').value);
    datos.append('grado', $('#vale-grado').value);
    const m = $('#vale-monto').value.trim();
    if (m) datos.append('monto', String(parsearMontoAR(m)));
    const archivo = $('#vale-foto').files[0];
    if (archivo) datos.append('foto', archivo);
    await api('/api/vales', { method: 'POST', body: datos });
    $('#modal-vale').close();
    aviso('Vale registrado correctamente');
    cargarVales();
  } catch (err) { mostrarError('#vale-error', err.message); }
  finally { btn.disabled = false; }
});

// ---------- Nómina ----------
let empleadosCache = [];
let detalleEmpleadoId = null;

function estadoVencimiento(venc) {
  if (!venc) return '';
  const hoy = fechaISOArgentina();
  if (venc < hoy) return `<span class="etiqueta etiqueta-baja">Vencido ${formatearFecha(venc)}</span>`;
  const en30 = new Intl.DateTimeFormat('en-CA', { timeZone: TZ_ARGENTINA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 30 * 86400000));
  if (venc <= en30) return `<span class="etiqueta etiqueta-alerta">Vence ${formatearFecha(venc)}</span>`;
  return formatearFecha(venc);
}

async function cargarOpcionesEmpleados() {
  try {
    const lista = await api('/api/empleados/opciones');
    $('#lista-empleados').innerHTML = lista.map((e) => `<option>${escapar(e.nombre)}</option>`).join('');
  } catch { /* sin permiso */ }
}

async function cargarNomina() {
  const todos = $('#ver-bajas-nomina').checked;
  empleadosCache = await api(`/api/empleados${todos ? '?todos=1' : ''}`);
  $('#empleados-vacio').classList.toggle('oculto', empleadosCache.length > 0);
  const puedeEditar = puede('editar_nomina');
  $('#tabla-empleados tbody').innerHTML = empleadosCache.map((e) => {
    let docs = '<span class="sin-foto">–</span>';
    if (e.docs_vencidos > 0) docs = `<span class="etiqueta etiqueta-baja">${e.docs_vencidos} vencido${e.docs_vencidos === 1 ? '' : 's'}</span>`;
    else if (e.docs_por_vencer > 0) docs = `<span class="etiqueta etiqueta-alerta">${e.docs_por_vencer} por vencer</span>`;
    else if (e.cant_docs > 0) docs = `<span class="etiqueta etiqueta-ok">${e.cant_docs} al día</span>`;
    return `<tr>
      <td><strong>${escapar(e.nombre)}</strong>${e.activo ? '' : ` <span class="etiqueta etiqueta-baja">BAJA${e.fecha_baja ? ' ' + formatearFecha(e.fecha_baja) : ''}</span>`}</td>
      <td>${escapar(e.puesto || '')}</td>
      <td>${escapar(e.telefono || '')}</td>
      <td>${docs}</td>
      <td class="num celda-acciones">
        <button class="btn btn-chico btn-primario" data-emp-ver="${e.id}">Ver</button>
        ${puedeEditar ? `<button class="btn btn-chico" data-emp-editar="${e.id}">Editar</button>
        <button class="btn btn-chico ${e.activo ? 'btn-peligro' : ''}" data-emp-baja="${e.id}" data-activo="${e.activo}">${e.activo ? 'Baja' : 'Alta'}</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

$('#ver-bajas-nomina').addEventListener('change', cargarNomina);
$('#btn-nuevo-empleado').addEventListener('click', () => abrirModalEmpleado(null));

$('#tabla-empleados').addEventListener('click', async (e) => {
  const bv = e.target.closest('[data-emp-ver]');
  const be = e.target.closest('[data-emp-editar]');
  const bb = e.target.closest('[data-emp-baja]');
  if (bv) { abrirDetalleEmpleado(Number(bv.dataset.empVer)); return; }
  if (be) { abrirModalEmpleado(empleadosCache.find((x) => x.id === Number(be.dataset.empEditar))); }
  if (bb) {
    const emp = empleadosCache.find((x) => x.id === Number(bb.dataset.empBaja));
    const activo = bb.dataset.activo === '1';
    if (!confirm(activo ? `¿Dar de baja a ${emp.nombre}? Su legajo se conserva.` : `¿Reincorporar a ${emp.nombre}?`)) return;
    await api(`/api/empleados/${emp.id}/activo`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: !activo }) });
    aviso(activo ? 'Dado de baja' : 'Reincorporado');
    cargarNomina();
    cargarOpcionesEmpleados();
  }
});

function abrirModalEmpleado(e) {
  $('#modal-empleado-titulo').textContent = e ? `Editar ${e.nombre}` : 'Agregar persona';
  $('#emp-id').value = e ? e.id : '';
  $('#emp-nombre').value = e ? e.nombre : '';
  $('#emp-dni').value = e && e.dni_cuil ? e.dni_cuil : '';
  $('#emp-telefono').value = e && e.telefono ? e.telefono : '';
  $('#emp-nacimiento').value = e && e.fecha_nacimiento ? e.fecha_nacimiento : '';
  $('#emp-puesto').value = e && e.puesto ? e.puesto : '';
  $('#emp-ingreso').value = e && e.fecha_ingreso ? e.fecha_ingreso : '';
  $('#emp-direccion').value = e && e.direccion ? e.direccion : '';
  $('#emp-emergencia').value = e && e.contacto_emergencia ? e.contacto_emergencia : '';
  $('#emp-notas').value = e && e.notas ? e.notas : '';
  $('#emp-error').classList.add('oculto');
  $('#modal-empleado').showModal();
}

$('#form-empleado').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#emp-id').value;
  const cuerpo = {
    nombre: $('#emp-nombre').value, dni_cuil: $('#emp-dni').value, telefono: $('#emp-telefono').value,
    fecha_nacimiento: $('#emp-nacimiento').value, puesto: $('#emp-puesto').value, fecha_ingreso: $('#emp-ingreso').value,
    direccion: $('#emp-direccion').value, contacto_emergencia: $('#emp-emergencia').value, notas: $('#emp-notas').value
  };
  try {
    await api(id ? `/api/empleados/${id}` : '/api/empleados', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    $('#modal-empleado').close();
    aviso(id ? 'Datos actualizados' : 'Persona agregada');
    cargarNomina();
    cargarOpcionesEmpleados();
    if (detalleEmpleadoId && id && Number(id) === detalleEmpleadoId) abrirDetalleEmpleado(detalleEmpleadoId);
  } catch (err) { mostrarError('#emp-error', err.message); }
});

// Legajo
async function abrirDetalleEmpleado(id) {
  const d = await api(`/api/empleados/${id}`);
  detalleEmpleadoId = id;
  const e = d.empleado;
  $('#emp-titulo').textContent = e.nombre + (e.activo ? '' : ' (baja)');
  const datos = [
    ['Nombre', e.nombre], ['DNI / CUIL', e.dni_cuil || '–'], ['Teléfono', e.telefono || '–'],
    ['Fecha de nacimiento', e.fecha_nacimiento ? formatearFecha(e.fecha_nacimiento) : '–'],
    ['Puesto', e.puesto || '–'], ['Fecha de ingreso', e.fecha_ingreso ? formatearFecha(e.fecha_ingreso) : '–'],
    ['Dirección', e.direccion || '–'], ['Contacto de emergencia', e.contacto_emergencia || '–'],
    ['Estado', e.activo ? 'Activo' : `Dado de baja${e.fecha_baja ? ' el ' + formatearFecha(e.fecha_baja) : ''}`],
    ['Notas', e.notas || '–']
  ];
  $('#emp-datos').innerHTML = datos.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapar(v)}</dd></div>`).join('');

  $('#docs-vacio').classList.toggle('oculto', d.documentos.length > 0);
  const puedeEditar = puede('editar_nomina');
  $('#tabla-docs tbody').innerHTML = d.documentos.map((doc) => `
    <tr>
      <td><strong>${escapar(doc.tipo)}</strong></td>
      <td>${estadoVencimiento(doc.vencimiento) || '<span class="sin-foto">–</span>'}</td>
      <td>${celdaComprobante(doc.archivo)}</td>
      <td>${escapar(doc.notas || '')}</td>
      <td class="num celda-acciones">${puedeEditar ? `<button class="btn btn-chico" data-doc-editar="${doc.id}">Editar</button>
        <button class="btn btn-chico btn-peligro" data-doc-borrar="${doc.id}">Eliminar</button>` : ''}</td>
    </tr>`).join('');
  $('#tabla-docs').dataset.docs = JSON.stringify(d.documentos);

  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('activo', b.dataset.seccion === 'nomina'));
  mostrarSeccion('seccion-empleado-detalle');
}

$('#btn-volver-nomina').addEventListener('click', () => { detalleEmpleadoId = null; irASeccion('nomina'); });
$('#btn-emp-editar').addEventListener('click', async () => {
  const d = await api(`/api/empleados/${detalleEmpleadoId}`);
  abrirModalEmpleado(d.empleado);
});

$('#btn-nuevo-doc').addEventListener('click', () => abrirModalDoc(null));

$('#tabla-docs').addEventListener('click', async (e) => {
  const be = e.target.closest('[data-doc-editar]');
  const bb = e.target.closest('[data-doc-borrar]');
  if (be) { abrirModalDoc(JSON.parse($('#tabla-docs').dataset.docs || '[]').find((x) => x.id === Number(be.dataset.docEditar))); }
  if (bb) {
    if (!confirm('¿Eliminar este documento? También se borra el archivo adjunto.')) return;
    await api(`/api/documentos/${bb.dataset.docBorrar}`, { method: 'DELETE' });
    aviso('Documento eliminado');
    abrirDetalleEmpleado(detalleEmpleadoId);
  }
});

function abrirModalDoc(doc) {
  $('#modal-doc-titulo').textContent = doc ? 'Editar documento' : 'Agregar documento';
  $('#doc-id').value = doc ? doc.id : '';
  $('#doc-tipo').value = doc ? doc.tipo : '';
  $('#doc-vencimiento').value = doc && doc.vencimiento ? doc.vencimiento : '';
  $('#doc-notas').value = doc && doc.notas ? doc.notas : '';
  $('#doc-archivo').value = '';
  $('#doc-error').classList.add('oculto');
  $('#modal-doc').showModal();
}

$('#form-doc').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#doc-id').value;
  const datos = new FormData();
  datos.append('tipo', $('#doc-tipo').value);
  datos.append('vencimiento', $('#doc-vencimiento').value);
  datos.append('notas', $('#doc-notas').value);
  const archivo = $('#doc-archivo').files[0];
  if (archivo) datos.append('archivo', archivo);
  try {
    await api(id ? `/api/documentos/${id}` : `/api/empleados/${detalleEmpleadoId}/documentos`, { method: id ? 'PUT' : 'POST', body: datos });
    $('#modal-doc').close();
    aviso('Documento guardado');
    abrirDetalleEmpleado(detalleEmpleadoId);
  } catch (err) { mostrarError('#doc-error', err.message); }
});

// ---------- Contactos ----------
async function cargarContactos() {
  contactosCache = await api('/api/contactos');
  const categorias = [...new Set(contactosCache.map((c) => c.categoria).filter(Boolean))].sort();
  const actual = $('#filtro-categoria-contacto').value;
  $('#filtro-categoria-contacto').innerHTML = '<option value="">Todas</option>' + categorias.map((c) => `<option>${escapar(c)}</option>`).join('');
  $('#filtro-categoria-contacto').value = actual;
  dibujarContactos();
}

function dibujarContactos() {
  const buscar = $('#buscar-contacto').value.trim().toLowerCase();
  const categoria = $('#filtro-categoria-contacto').value;
  const filas = contactosCache.filter((c) => {
    if (categoria && c.categoria !== categoria) return false;
    if (!buscar) return true;
    return [c.nombre, c.empresa, c.telefono, c.pais, c.categoria, c.notas].some((campo) => campo && campo.toLowerCase().includes(buscar));
  });
  $('#contactos-vacio').classList.toggle('oculto', filas.length > 0);
  const puedeEditar = puede('editar_contactos');
  $('#tabla-contactos tbody').innerHTML = filas.map((c) => `
    <tr>
      <td><strong>${escapar(c.nombre)}</strong></td>
      <td>${escapar(c.empresa || '')}</td>
      <td>${escapar(c.telefono || '')}</td>
      <td>${escapar(c.pais || '')}</td>
      <td>${c.categoria ? `<span class="etiqueta etiqueta-categoria">${escapar(c.categoria)}</span>` : ''}</td>
      <td>${escapar(c.notas || '')}</td>
      <td class="num celda-acciones">${puedeEditar ? `<button class="btn btn-chico" data-con-editar="${c.id}">Editar</button>
        <button class="btn btn-chico btn-peligro" data-con-borrar="${c.id}">Eliminar</button>` : ''}</td>
    </tr>`).join('');
}

$('#buscar-contacto').addEventListener('input', dibujarContactos);
$('#filtro-categoria-contacto').addEventListener('change', dibujarContactos);
$('#btn-nuevo-contacto').addEventListener('click', () => abrirModalContacto(null));

$('#tabla-contactos').addEventListener('click', async (e) => {
  const btnEditar = e.target.closest('[data-con-editar]');
  const btnBorrar = e.target.closest('[data-con-borrar]');
  if (btnEditar) { abrirModalContacto(contactosCache.find((c) => c.id === Number(btnEditar.dataset.conEditar))); }
  if (btnBorrar) {
    const c = contactosCache.find((x) => x.id === Number(btnBorrar.dataset.conBorrar));
    if (!confirm(`¿Eliminar el contacto "${c.nombre}"?`)) return;
    await api(`/api/contactos/${c.id}`, { method: 'DELETE' });
    aviso('Contacto eliminado');
    cargarContactos();
  }
});

function abrirModalContacto(c) {
  $('#modal-contacto-titulo').textContent = c ? 'Editar contacto' : 'Agregar contacto';
  $('#contacto-id').value = c ? c.id : '';
  $('#contacto-nombre').value = c ? c.nombre : '';
  $('#contacto-empresa').value = c && c.empresa ? c.empresa : '';
  $('#contacto-telefono').value = c && c.telefono ? c.telefono : '';
  $('#contacto-pais').value = c && c.pais ? c.pais : '';
  $('#contacto-categoria').value = c && c.categoria ? c.categoria : '';
  $('#contacto-notas').value = c && c.notas ? c.notas : '';
  $('#contacto-error').classList.add('oculto');
  $('#modal-contacto').showModal();
}

$('#form-contacto').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#contacto-id').value;
  const cuerpo = { nombre: $('#contacto-nombre').value, empresa: $('#contacto-empresa').value, telefono: $('#contacto-telefono').value, pais: $('#contacto-pais').value, categoria: $('#contacto-categoria').value, notas: $('#contacto-notas').value };
  try {
    await api(id ? `/api/contactos/${id}` : '/api/contactos', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    $('#modal-contacto').close();
    aviso(id ? 'Contacto actualizado' : 'Contacto agregado');
    cargarContactos();
  } catch (err) { mostrarError('#contacto-error', err.message); }
});

// ---------- Seguimiento contable ----------
async function cargarFinanzas() {
  if (!$('#filtro-mes-gastos').value) $('#filtro-mes-gastos').value = mesActualArgentina();
  const mes = $('#filtro-mes-gastos').value;
  const anio = mes.slice(0, 4);

  const verLista = puede('ver_gastos');
  const verTotales = puede('ver_totales_gastos');

  const gastos = verLista ? await api(`/api/gastos?mes=${mes}`) : [];
  const resumen = verTotales ? await api(`/api/gastos/resumen?anio=${anio}`) : null;

  if (verTotales) {
    const totalMes = gastos.reduce((s, g) => s + g.monto, 0);
    $('#stat-gasto-mes-fin').textContent = formatearDinero(totalMes);
    $('#stat-gasto-mes-titulo').textContent = `Gasto de ${nombreMes(mes)}`;
    $('#stat-gasto-anio').textContent = formatearDinero(resumen.total);
    $('#stat-gasto-anio-titulo').textContent = `Total del año ${anio}`;
    $('#titulo-categorias').textContent = `Por categoría (${anio})`;
    $('#titulo-meses').textContent = `Mes a mes (${anio})`;
    $('#tabla-gastos-categoria tbody').innerHTML = resumen.por_categoria.length
      ? resumen.por_categoria.map((c) => `<tr><td>${escapar(c.categoria)}</td><td class="num">${formatearDinero(c.total)}</td></tr>`).join('')
      : '<tr><td colspan="2" class="texto-vacio">Sin gastos este año</td></tr>';
    $('#tabla-gastos-mes-a-mes tbody').innerHTML = resumen.por_mes.length
      ? resumen.por_mes.map((m) => `<tr><td>${nombreMes(m.mes)}</td><td class="num">${m.cantidad}</td><td class="num">${formatearDinero(m.total)}</td></tr>`).join('') +
        `<tr class="fila-total"><td><strong>Total ${anio}</strong></td><td></td><td class="num"><strong>${formatearDinero(resumen.total)}</strong></td></tr>`
      : '<tr><td colspan="3" class="texto-vacio">Sin gastos este año</td></tr>';
  }

  if (verLista) {
    $('#stat-gastos-cantidad').textContent = gastos.length;
    $('#titulo-gastos-mes').textContent = `Gastos de ${nombreMes(mes)}`;
    $('#gastos-resumen-filtro').textContent = gastos.length ? `${gastos.length} gasto${gastos.length === 1 ? '' : 's'}${verTotales ? ' · ' + formatearDinero(gastos.reduce((s, g) => s + g.monto, 0)) : ''}` : '';
    $('#gastos-vacio').classList.toggle('oculto', gastos.length > 0);
    const puedeEditar = puede('cargar_gastos');
    $('#tabla-gastos tbody').innerHTML = gastos.map((g) => {
      const esVale = g.origen === 'vale';
      return `
      <tr>
        <td>${formatearFecha(g.fecha)}</td>
        <td><span class="etiqueta etiqueta-categoria">${escapar(g.categoria)}</span></td>
        <td>${escapar(g.descripcion || '')}${g.patente ? `<br><small class="texto-suave">${escapar(g.patente)} · ${escapar(g.v_marca)} ${escapar(g.v_modelo)}</small>` : ''}${esVale ? '<br><small class="texto-suave">desde un vale de combustible</small>' : ''}</td>
        <td class="num"><strong>${formatearDinero(g.monto)}</strong></td>
        <td>${celdaComprobante(g.comprobante_archivo)}</td>
        <td class="num celda-acciones">${esVale ? '<span class="permisos-mini">vale</span>' : (puedeEditar ? `<button class="btn btn-chico" data-gasto-editar="${g.id}">Editar</button>
          <button class="btn btn-chico btn-peligro" data-gasto-borrar="${g.id}">Eliminar</button>` : '')}</td>
      </tr>`; }).join('');
    $('#tabla-gastos').dataset.gastos = JSON.stringify(gastos.filter((g) => g.origen !== 'vale'));
  }
}

$('#filtro-mes-gastos').addEventListener('change', cargarFinanzas);

function actualizarHintMonto() {
  const hint = $('#gasto-monto-hint');
  const val = $('#gasto-monto').value.trim();
  if (!val) { hint.textContent = ''; hint.classList.remove('hint-error'); return; }
  const n = parsearMontoAR(val);
  if (!Number.isFinite(n) || n <= 0) { hint.textContent = 'Ingresá un monto válido'; hint.classList.add('hint-error'); }
  else { hint.textContent = '= ' + formatearDinero(n); hint.classList.remove('hint-error'); }
}
$('#gasto-monto').addEventListener('input', actualizarHintMonto);

$('#btn-nuevo-gasto').addEventListener('click', async () => {
  if (!opcionesVehiculos.length) await cargarOpcionesVehiculos();
  $('#modal-gasto-titulo').textContent = 'Registrar gasto';
  $('#form-gasto').reset();
  $('#gasto-id').value = '';
  $('#gasto-fecha').value = fechaISOArgentina();
  $('#gasto-monto-hint').textContent = '';
  $('#gasto-error').classList.add('oculto');
  $('#modal-gasto').showModal();
});

$('#tabla-gastos').addEventListener('click', async (e) => {
  const btnEditar = e.target.closest('[data-gasto-editar]');
  const btnBorrar = e.target.closest('[data-gasto-borrar]');
  if (btnEditar) {
    const g = JSON.parse($('#tabla-gastos').dataset.gastos || '[]').find((x) => x.id === Number(btnEditar.dataset.gastoEditar));
    if (!g) return;
    $('#modal-gasto-titulo').textContent = 'Editar gasto';
    $('#gasto-id').value = g.id;
    $('#gasto-fecha').value = g.fecha;
    $('#gasto-monto').value = g.monto;
    $('#gasto-categoria').value = g.categoria;
    $('#gasto-vehiculo').value = g.vehiculo_id ? String(g.vehiculo_id) : '';
    $('#gasto-descripcion').value = g.descripcion || '';
    $('#gasto-comprobante').value = '';
    actualizarHintMonto();
    $('#gasto-error').classList.add('oculto');
    $('#modal-gasto').showModal();
  }
  if (btnBorrar) {
    if (!confirm('¿Eliminar este gasto? También se borra su comprobante.')) return;
    await api(`/api/gastos/${btnBorrar.dataset.gastoBorrar}`, { method: 'DELETE' });
    aviso('Gasto eliminado');
    cargarFinanzas();
  }
});

$('#form-gasto').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#gasto-id').value;
  const montoNum = parsearMontoAR($('#gasto-monto').value);
  if (!Number.isFinite(montoNum) || montoNum <= 0) { mostrarError('#gasto-error', 'Ingresá un monto válido (por ejemplo: 150.000)'); return; }
  const datos = new FormData();
  datos.append('fecha', $('#gasto-fecha').value);
  datos.append('monto', String(montoNum));
  datos.append('categoria', $('#gasto-categoria').value);
  datos.append('vehiculo_id', $('#gasto-vehiculo').value);
  datos.append('descripcion', $('#gasto-descripcion').value);
  const archivo = $('#gasto-comprobante').files[0];
  if (archivo) datos.append('comprobante', archivo);
  try {
    await api(id ? `/api/gastos/${id}` : '/api/gastos', { method: id ? 'PUT' : 'POST', body: datos });
    $('#modal-gasto').close();
    aviso(id ? 'Gasto actualizado' : 'Gasto registrado');
    cargarFinanzas();
  } catch (err) { mostrarError('#gasto-error', err.message); }
});

// ---------- Usuarios (solo admin) ----------
async function cargarUsuarios() {
  if (!window.ES_ADMIN) return;
  const [usuarios, catalogo] = await Promise.all([
    api('/api/usuarios'),
    permisosCatalogo ? Promise.resolve(permisosCatalogo) : api('/api/permisos')
  ]);
  permisosCatalogo = catalogo;
  usuariosCache = usuarios;
  const yo = $('#usuario-actual').textContent;
  $('#tabla-usuarios tbody').innerHTML = usuarios.map((u) => {
    const esYo = u.username === yo;
    const permisosTxt = u.rol === 'admin'
      ? '<span class="permisos-mini">Acceso total</span>'
      : `<span class="permisos-mini">${u.permisos.length} permiso${u.permisos.length === 1 ? '' : 's'}</span>`;
    return `<tr>
      <td><strong>${escapar(u.username)}</strong>${esYo ? ' <span class="permisos-mini">(vos)</span>' : ''}</td>
      <td>${escapar(u.nombre || '')}</td>
      <td>${u.rol === 'admin' ? '<span class="etiqueta etiqueta-rol">Administrador</span>' : '<span class="etiqueta etiqueta-rol-op">Personalizada</span>'}</td>
      <td>${permisosTxt}</td>
      <td class="num celda-acciones">
        <button class="btn btn-chico" data-usr-editar="${u.id}">Editar</button>
        <button class="btn btn-chico" data-usr-pass="${u.id}">Contraseña</button>
        <button class="btn btn-chico btn-peligro" data-usr-borrar="${u.id}" ${esYo ? 'disabled' : ''}>Eliminar</button>
      </td>
    </tr>`;
  }).join('');
}

function construirPermisos(seleccionados) {
  const set = new Set(seleccionados || []);
  $('#usuario-permisos').innerHTML = permisosCatalogo.map((g) => `
    <div class="permisos-grupo">
      <h4>${escapar(g.titulo)}</h4>
      ${g.permisos.map((p) => `
        <label class="permiso-item">
          <input type="checkbox" value="${p.clave}" ${set.has(p.clave) ? 'checked' : ''}>
          <span>${escapar(p.texto)}</span>
        </label>`).join('')}
    </div>`).join('');
}

function abrirModalUsuario(u) {
  $('#modal-usuario-titulo').textContent = u ? 'Editar usuario' : 'Crear usuario';
  $('#usuario-id').value = u ? u.id : '';
  $('#usuario-username').value = u ? u.username : '';
  $('#usuario-nombre').value = u && u.nombre ? u.nombre : '';
  $('#usuario-password').value = '';
  $('#usuario-password-caja').classList.toggle('oculto', !!u);
  $('#usuario-password').required = !u;
  $('#usuario-rol').value = u ? u.rol : 'operador';
  $('#usuario-permisos-caja').classList.toggle('oculto', $('#usuario-rol').value === 'admin');
  construirPermisos(u ? u.permisos : []);
  $('#usuario-error').classList.add('oculto');
  $('#modal-usuario').showModal();
}

$('#btn-nuevo-usuario').addEventListener('click', () => abrirModalUsuario(null));
$('#usuario-rol').addEventListener('change', () => $('#usuario-permisos-caja').classList.toggle('oculto', $('#usuario-rol').value === 'admin'));
$('#btn-marcar-todos').addEventListener('click', () => document.querySelectorAll('#usuario-permisos input').forEach((i) => { i.checked = true; }));
$('#btn-desmarcar-todos').addEventListener('click', () => document.querySelectorAll('#usuario-permisos input').forEach((i) => { i.checked = false; }));

$('#tabla-usuarios').addEventListener('click', async (e) => {
  const be = e.target.closest('[data-usr-editar]');
  const bp = e.target.closest('[data-usr-pass]');
  const bb = e.target.closest('[data-usr-borrar]');
  if (be) { abrirModalUsuario(usuariosCache.find((u) => u.id === Number(be.dataset.usrEditar))); }
  if (bp) {
    const u = usuariosCache.find((x) => x.id === Number(bp.dataset.usrPass));
    $('#usuario-pass-id').value = u.id;
    $('#usuario-pass-nombre').textContent = 'Cuenta: ' + u.username;
    $('#usuario-pass-nueva').value = '';
    $('#usuario-pass-error').classList.add('oculto');
    $('#modal-usuario-pass').showModal();
  }
  if (bb) {
    const u = usuariosCache.find((x) => x.id === Number(bb.dataset.usrBorrar));
    if (!confirm(`¿Eliminar el usuario "${u.username}"? No se puede deshacer.`)) return;
    try { await api(`/api/usuarios/${u.id}`, { method: 'DELETE' }); aviso('Usuario eliminado'); cargarUsuarios(); }
    catch (err) { alert(err.message); }
  }
});

$('#form-usuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#usuario-id').value;
  const permisos = [...document.querySelectorAll('#usuario-permisos input:checked')].map((i) => i.value);
  const cuerpo = { username: $('#usuario-username').value.trim(), nombre: $('#usuario-nombre').value.trim(), rol: $('#usuario-rol').value, permisos };
  if (!id) cuerpo.password = $('#usuario-password').value;
  try {
    if (!id && cuerpo.password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
    await api(id ? `/api/usuarios/${id}` : '/api/usuarios', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    $('#modal-usuario').close();
    aviso(id ? 'Usuario actualizado' : 'Usuario creado');
    cargarUsuarios();
  } catch (err) { mostrarError('#usuario-error', err.message); }
});

$('#form-usuario-pass').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/usuarios/${$('#usuario-pass-id').value}/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#usuario-pass-nueva').value }) });
    $('#modal-usuario-pass').close();
    aviso('Contraseña actualizada');
  } catch (err) { mostrarError('#usuario-pass-error', err.message); }
});

// ---------- Configuración ----------
$('#form-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msj = $('#password-mensaje');
  msj.classList.add('oculto');
  if ($('#pass-nueva').value !== $('#pass-repetir').value) {
    msj.className = 'mensaje-error'; msj.textContent = 'Las contraseñas nuevas no coinciden'; return;
  }
  try {
    await api('/api/cambiar-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actual: $('#pass-actual').value, nueva: $('#pass-nueva').value }) });
    msj.className = 'mensaje-ok'; msj.textContent = 'Contraseña actualizada correctamente';
    $('#form-password').reset();
  } catch (err) { msj.className = 'mensaje-error'; msj.textContent = err.message; }
});

// ---------- Inicio ----------
(async () => {
  try { await iniciarSesion(); }
  catch { mostrarLogin(); }
})();
