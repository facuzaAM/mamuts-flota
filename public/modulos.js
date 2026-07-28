/* MAMUTS · Módulos Habitacionales — lógica de la interfaz */

const $ = (sel) => document.querySelector(sel);

// Comparte la sesión con el sistema de flota: si no hay login, vuelve al inicio.
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
}

function puede(clave) { return window.ES_ADMIN || window.PERMISOS.has(clave); }

// ---------- Navegación ----------
function irASeccion(nombre) {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('activo', b.dataset.seccion === nombre));
  document.querySelectorAll('.seccion').forEach((s) => s.classList.add('oculto'));
  $(`#seccion-${nombre}`).classList.remove('oculto');
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => irASeccion(btn.dataset.seccion));
});

verificarSesion();
