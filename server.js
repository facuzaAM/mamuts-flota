const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Clave de sesión persistente (se genera una sola vez)
const keyFile = path.join(__dirname, 'data', '.session-key');
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'));
const SESSION_KEY = fs.readFileSync(keyFile, 'utf8').trim();

const EN_PRODUCCION = process.env.NODE_ENV === 'production';
if (EN_PRODUCCION) app.set('trust proxy', 1);

app.use(express.json());
app.use(cookieSession({
  name: 'mamuts_sesion',
  keys: [SESSION_KEY],
  maxAge: 12 * 60 * 60 * 1000, // 12 horas
  httpOnly: true,
  sameSite: 'lax',
  secure: EN_PRODUCCION // en producción (HTTPS) la cookie nunca viaja en claro
}));

// Nunca aparecer en buscadores
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (!req.path.startsWith('/uploads')) {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
  }
  next();
});
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));

// Subida de archivos adjuntos (fotos de vales, vehículos y comprobantes)
const subida = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      // Solo extensiones conocidas: evita guardar/servir archivos con tipo peligroso (ej. .html)
      const ext = (path.extname(file.originalname) || '').toLowerCase();
      const extSegura = /^\.(jpe?g|png|webp|heic|heif|pdf)$/.test(ext) ? ext : '';
      cb(null, `adj-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${extSegura}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype) || file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Solo se aceptan imágenes (JPG, PNG, WEBP) o PDF'), ok);
  }
});

// Fecha de hoy en Argentina (YYYY-MM-DD), sin importar la zona del servidor
const TZ_AR = 'America/Argentina/Buenos_Aires';
function hoyAR(masDias = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ_AR, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + masDias * 86400000));
}
function inicioMesAR() { return hoyAR().slice(0, 7) + '-01'; }

// Rango [inicio, fin) de un mes "YYYY-MM": consultas por fecha que aprovechan el índice
function rangoMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  const sig = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  return [`${mes}-01`, `${sig}-01`];
}

function borrarAdjunto(nombre) {
  if (!nombre) return;
  const ruta = path.join(UPLOADS_DIR, path.basename(nombre));
  if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
}

// Bitácora: cada cambio queda registrado para la sección Actualizaciones.
// `permiso` es el que hace falta para ver esa novedad (null = todos los usuarios).
const stmtActividad = db.prepare(
  'INSERT INTO actividad (fecha, usuario, area, accion, detalle, entidad_id, permiso) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
function registrar(req, area, accion, detalle, permiso = null, entidadId = null) {
  try {
    stmtActividad.run(new Date().toISOString(), req.usuario ? req.usuario.username : null,
      area, accion, detalle || null, entidadId, permiso);
  } catch (e) {
    console.error('No se pudo registrar la actividad:', e.message);
  }
}

// ---------- Autenticación y permisos ----------
const intentosLogin = new Map(); // ip -> { fallos, bloqueadoHasta }

// Catálogo de permisos disponibles (el admin siempre los tiene todos)
const PERMISOS = {
  ver_vehiculos: 'Ver vehículos y sus fichas',
  editar_vehiculos: 'Agregar, editar y dar de baja vehículos',
  ver_consumo_vehiculo: 'Ver el consumo de litros de cada vehículo',
  cargar_vales: 'Registrar vales de combustible',
  ver_vales: 'Ver el listado de vales',
  ver_totales_litros: 'Ver totales de litros por mes y año',
  ver_panol: 'Ver el pañol y el stock de materiales',
  editar_panol: 'Agregar materiales al pañol y ajustar cantidades',
  ver_actualizaciones: 'Ver la sección Actualizaciones (novedades del sistema)',
  ver_nomina: 'Ver la nómina y los legajos del personal',
  editar_nomina: 'Agregar, editar y dar de baja personal y su documentación',
  ver_contactos: 'Ver contactos',
  editar_contactos: 'Agregar, editar y borrar contactos',
  cargar_gastos: 'Registrar gastos',
  ver_gastos: 'Ver el listado de gastos',
  ver_totales_gastos: 'Ver totales de gastos (mes, año y por categoría)'
};
const PERMISOS_VALIDOS = new Set(Object.keys(PERMISOS));

function requiereLogin(req, res, next) {
  if (!(req.session && req.session.userId)) return res.status(401).json({ error: 'No autenticado' });
  const u = db.prepare('SELECT id, username, rol, permisos FROM usuarios WHERE id = ?').get(req.session.userId);
  if (!u) { req.session = null; return res.status(401).json({ error: 'No autenticado' }); }
  let permisos = [];
  try { permisos = u.permisos ? JSON.parse(u.permisos) : []; } catch { permisos = []; }
  req.usuario = { id: u.id, username: u.username, rol: u.rol, permisos: new Set(permisos) };
  next();
}

function tiene(req, clave) {
  return req.usuario.rol === 'admin' || req.usuario.permisos.has(clave);
}
function requierePermiso(clave) {
  return (req, res, next) => tiene(req, clave)
    ? next()
    : res.status(403).json({ error: 'No tenés permiso para realizar esta acción' });
}
function soloAdmin(req, res, next) {
  return req.usuario.rol === 'admin'
    ? next()
    : res.status(403).json({ error: 'Solo un administrador puede hacer esto' });
}

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  // Limpieza periódica para que el mapa de intentos no crezca sin límite
  if (intentosLogin.size > 500) {
    for (const [k, r] of intentosLogin) if (Date.now() > r.bloqueadoHasta) intentosLogin.delete(k);
  }
  const registro = intentosLogin.get(ip) || { fallos: 0, bloqueadoHasta: 0 };
  if (Date.now() < registro.bloqueadoHasta) {
    return res.status(429).json({ error: 'Demasiados intentos fallidos. Esperá 15 minutos.' });
  }
  const { username, password } = req.body || {};
  const user = username && db.prepare('SELECT * FROM usuarios WHERE username = ?').get(String(username).trim());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    registro.fallos += 1;
    if (registro.fallos >= 5) {
      registro.bloqueadoHasta = Date.now() + 15 * 60 * 1000;
      registro.fallos = 0;
    }
    intentosLogin.set(ip, registro);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  intentosLogin.delete(ip);
  req.session.userId = user.id;
  res.json({ ok: true, username: user.username, rol: user.rol });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/me', requiereLogin, (req, res) => {
  res.json({
    username: req.usuario.username,
    rol: req.usuario.rol,
    es_admin: req.usuario.rol === 'admin',
    permisos: [...req.usuario.permisos]
  });
});

// Catálogo de permisos (para armar la pantalla de usuarios)
app.get('/api/permisos', requiereLogin, soloAdmin, (req, res) => {
  const grupos = [
    { titulo: 'Vehículos', claves: ['ver_vehiculos', 'editar_vehiculos', 'ver_consumo_vehiculo'] },
    { titulo: 'Vales de combustible', claves: ['cargar_vales', 'ver_vales', 'ver_totales_litros'] },
    { titulo: 'Pañol', claves: ['ver_panol', 'editar_panol'] },
    { titulo: 'Nómina', claves: ['ver_nomina', 'editar_nomina'] },
    { titulo: 'Actualizaciones', claves: ['ver_actualizaciones'] },
    { titulo: 'Contactos', claves: ['ver_contactos', 'editar_contactos'] },
    { titulo: 'Seguimiento contable', claves: ['cargar_gastos', 'ver_gastos', 'ver_totales_gastos'] }
  ].map((g) => ({ titulo: g.titulo, permisos: g.claves.map((c) => ({ clave: c, texto: PERMISOS[c] })) }));
  res.json(grupos);
});

// ---------- Gestión de usuarios (solo admin) ----------
function limpiarPermisos(lista) {
  if (!Array.isArray(lista)) return [];
  return [...new Set(lista.filter((p) => PERMISOS_VALIDOS.has(p)))];
}

app.get('/api/usuarios', requiereLogin, soloAdmin, (req, res) => {
  const filas = db.prepare('SELECT id, username, nombre, rol, permisos, creado_en FROM usuarios ORDER BY username COLLATE NOCASE').all();
  res.json(filas.map((u) => ({
    id: u.id, username: u.username, nombre: u.nombre, rol: u.rol,
    permisos: (() => { try { return u.permisos ? JSON.parse(u.permisos) : []; } catch { return []; } })(),
    creado_en: u.creado_en
  })));
});

app.post('/api/usuarios', requiereLogin, soloAdmin, (req, res) => {
  const username = String(req.body.username || '').trim();
  const nombre = String(req.body.nombre || '').trim() || null;
  const password = String(req.body.password || '');
  const rol = req.body.rol === 'admin' ? 'admin' : 'operador';
  if (!/^[a-zA-Z0-9._-]{3,}$/.test(username)) {
    return res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres (letras, números, . _ -)' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  const permisos = rol === 'admin' ? null : JSON.stringify(limpiarPermisos(req.body.permisos));
  try {
    const info = db.prepare('INSERT INTO usuarios (username, nombre, password_hash, rol, permisos) VALUES (?, ?, ?, ?, ?)')
      .run(username, nombre, bcrypt.hashSync(password, 10), rol, permisos);
    registrar(req, 'Usuarios', 'Usuario creado', `${username} (${rol === 'admin' ? 'administrador' : 'personalizada'})`, 'ver_usuarios_actividad', info.lastInsertRowid);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: `Ya existe un usuario llamado "${username}"` });
    throw e;
  }
});

app.put('/api/usuarios/:id', requiereLogin, soloAdmin, (req, res) => {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  const username = String(req.body.username || '').trim();
  const nombre = String(req.body.nombre || '').trim() || null;
  const rol = req.body.rol === 'admin' ? 'admin' : 'operador';
  if (!/^[a-zA-Z0-9._-]{3,}$/.test(username)) {
    return res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres (letras, números, . _ -)' });
  }
  // No permitir quitar el último administrador
  if (usuario.rol === 'admin' && rol !== 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin'").get().n;
    if (admins <= 1) return res.status(400).json({ error: 'Tiene que quedar al menos un administrador' });
  }
  const permisos = rol === 'admin' ? null : JSON.stringify(limpiarPermisos(req.body.permisos));
  try {
    db.prepare('UPDATE usuarios SET username = ?, nombre = ?, rol = ?, permisos = ? WHERE id = ?')
      .run(username, nombre, rol, permisos, usuario.id);
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: `Ya existe un usuario llamado "${username}"` });
    throw e;
  }
});

app.post('/api/usuarios/:id/password', requiereLogin, soloAdmin, (req, res) => {
  const usuario = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), usuario.id);
  res.json({ ok: true });
});

app.delete('/api/usuarios/:id', requiereLogin, soloAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.usuario.id) return res.status(400).json({ error: 'No podés eliminar tu propio usuario' });
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (usuario.rol === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin'").get().n;
    if (admins <= 1) return res.status(400).json({ error: 'Tiene que quedar al menos un administrador' });
  }
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/cambiar-password', requiereLogin, (req, res) => {
  const { actual, nueva } = req.body || {};
  if (!nueva || String(nueva).length < 8) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
  }
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(String(actual || ''), user.password_hash)) {
    return res.status(400).json({ error: 'La contraseña actual es incorrecta' });
  }
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(String(nueva), 10), user.id);
  res.json({ ok: true });
});

// ---------- Vehículos ----------
app.get('/api/vehiculos', requiereLogin, requierePermiso('ver_vehiculos'), (req, res) => {
  const incluirInactivos = req.query.todos === '1';
  const verConsumo = tiene(req, 'ver_consumo_vehiculo');
  const inicioMes = inicioMesAR();
  const filas = db.prepare(`
    SELECT v.*,
      (SELECT COUNT(*) FROM vales x WHERE x.vehiculo_id = v.id AND x.fecha >= @inicioMes) AS cant_vales,
      (SELECT COALESCE(SUM(litros), 0) FROM vales x WHERE x.vehiculo_id = v.id AND x.fecha >= @inicioMes) AS total_litros
    FROM vehiculos v
    ${incluirInactivos ? '' : 'WHERE v.activo = 1'}
    ORDER BY v.marca, v.modelo
  `).all({ inicioMes });
  // Si no puede ver el consumo, no le mandamos esos datos
  res.json(filas.map((v) => verConsumo ? v : ({ ...v, cant_vales: null, total_litros: null })));
});

// Lista mínima para los desplegables (quien carga vales o gastos necesita elegir vehículo)
app.get('/api/vehiculos/opciones', requiereLogin, (req, res) => {
  if (!(tiene(req, 'ver_vehiculos') || tiene(req, 'cargar_vales') || tiene(req, 'cargar_gastos'))) {
    return res.status(403).json({ error: 'No tenés permiso' });
  }
  res.json(db.prepare('SELECT id, patente, marca, modelo FROM vehiculos WHERE activo = 1 ORDER BY marca, modelo').all());
});

// Ficha completa: datos, foto, datos técnicos y últimos vales
app.get('/api/vehiculos/:id', requiereLogin, requierePermiso('ver_vehiculos'), (req, res) => {
  const vehiculo = db.prepare('SELECT * FROM vehiculos WHERE id = ?').get(req.params.id);
  if (!vehiculo) return res.status(404).json({ error: 'Vehículo no encontrado' });
  const tecnicos = db.prepare('SELECT * FROM datos_tecnicos WHERE vehiculo_id = ? ORDER BY tipo, id').all(vehiculo.id);
  const verConsumo = tiene(req, 'ver_consumo_vehiculo');
  if (!verConsumo) return res.json({ vehiculo, tecnicos, vales: [], cant_vales: null, total_litros: null, litros_mes: null, sin_consumo: true });
  const vales = db.prepare('SELECT * FROM vales WHERE vehiculo_id = ? ORDER BY fecha DESC, id DESC LIMIT 5').all(vehiculo.id);
  const resumen = db.prepare('SELECT COUNT(*) AS cant_vales, COALESCE(SUM(litros), 0) AS total_litros FROM vales WHERE vehiculo_id = ?').get(vehiculo.id);
  const mes = db.prepare('SELECT COALESCE(SUM(litros), 0) AS litros_mes FROM vales WHERE vehiculo_id = ? AND fecha >= ?').get(vehiculo.id, inicioMesAR());
  res.json({ vehiculo, tecnicos, vales, ...resumen, litros_mes: mes.litros_mes });
});

function validarVehiculo(body) {
  const marca = String(body.marca || '').trim();
  const modelo = String(body.modelo || '').trim();
  const patente = String(body.patente || '').trim().toUpperCase();
  if (!marca || !modelo || !patente) return { error: 'Marca, modelo y patente son obligatorios' };
  const anio = body.anio ? parseInt(body.anio, 10) : null;
  const kilometraje = body.kilometraje !== '' && body.kilometraje != null ? parseInt(body.kilometraje, 10) : null;
  return {
    datos: {
      marca, modelo, patente,
      anio: Number.isFinite(anio) ? anio : null,
      tipo_combustible: String(body.tipo_combustible || 'Diesel').trim(),
      kilometraje: Number.isFinite(kilometraje) ? kilometraje : null,
      chofer: String(body.chofer || '').trim() || null,
      propiedad: ['Propio', 'Alquilado', 'Particular'].includes(body.propiedad) ? body.propiedad : 'Propio',
      notas: String(body.notas || '').trim() || null
    }
  };
}

app.post('/api/vehiculos', requiereLogin, requierePermiso('editar_vehiculos'), (req, res) => {
  subida.single('foto')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const v = validarVehiculo(req.body || {});
    if (v.error) {
      if (req.file) borrarAdjunto(req.file.filename);
      return res.status(400).json({ error: v.error });
    }
    try {
      const info = db.prepare(`
        INSERT INTO vehiculos (marca, modelo, patente, anio, tipo_combustible, kilometraje, chofer, propiedad, notas, foto_archivo)
        VALUES (@marca, @modelo, @patente, @anio, @tipo_combustible, @kilometraje, @chofer, @propiedad, @notas, @foto_archivo)
      `).run({ ...v.datos, foto_archivo: req.file ? req.file.filename : null });
      registrar(req, 'Vehículos', 'Vehículo agregado', `${v.datos.patente} · ${v.datos.marca} ${v.datos.modelo}`, 'ver_vehiculos', info.lastInsertRowid);
      res.json({ ok: true, id: info.lastInsertRowid });
    } catch (e) {
      if (req.file) borrarAdjunto(req.file.filename);
      if (String(e.message).includes('UNIQUE')) {
        return res.status(400).json({ error: `Ya existe un vehículo con la patente ${v.datos.patente}` });
      }
      throw e;
    }
  });
});

app.put('/api/vehiculos/:id', requiereLogin, requierePermiso('editar_vehiculos'), (req, res) => {
  subida.single('foto')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const actual = db.prepare('SELECT * FROM vehiculos WHERE id = ?').get(req.params.id);
    if (!actual) {
      if (req.file) borrarAdjunto(req.file.filename);
      return res.status(404).json({ error: 'Vehículo no encontrado' });
    }
    const v = validarVehiculo(req.body || {});
    if (v.error) {
      if (req.file) borrarAdjunto(req.file.filename);
      return res.status(400).json({ error: v.error });
    }
    let foto = actual.foto_archivo;
    if (req.file) {
      borrarAdjunto(actual.foto_archivo);
      foto = req.file.filename;
    } else if (req.body.quitar_foto === '1') {
      borrarAdjunto(actual.foto_archivo);
      foto = null;
    }
    try {
      db.prepare(`
        UPDATE vehiculos SET marca=@marca, modelo=@modelo, patente=@patente, anio=@anio,
          tipo_combustible=@tipo_combustible, kilometraje=@kilometraje, chofer=@chofer, propiedad=@propiedad,
          notas=@notas, foto_archivo=@foto_archivo
        WHERE id=@id
      `).run({ ...v.datos, foto_archivo: foto, id: actual.id });
      res.json({ ok: true });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return res.status(400).json({ error: `Ya existe un vehículo con la patente ${v.datos.patente}` });
      }
      throw e;
    }
  });
});

// Baja lógica: el vehículo deja de aparecer pero su historial se conserva
app.patch('/api/vehiculos/:id/activo', requiereLogin, requierePermiso('editar_vehiculos'), (req, res) => {
  const activo = req.body && req.body.activo ? 1 : 0;
  const info = db.prepare('UPDATE vehiculos SET activo = ? WHERE id = ?').run(activo, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Vehículo no encontrado' });
  res.json({ ok: true });
});

// ---------- Datos técnicos del vehículo ----------
function validarTecnico(body) {
  const tipo = String(body.tipo || '').trim();
  if (!tipo) return { error: 'El tipo de dato es obligatorio (ej: Filtro de aceite)' };
  return {
    datos: {
      tipo,
      codigo: String(body.codigo || '').trim() || null,
      marca: String(body.marca || '').trim() || null,
      notas: String(body.notas || '').trim() || null
    }
  };
}

app.post('/api/vehiculos/:id/tecnicos', requiereLogin, requierePermiso('editar_vehiculos'), (req, res) => {
  const vehiculo = db.prepare('SELECT id FROM vehiculos WHERE id = ?').get(req.params.id);
  if (!vehiculo) return res.status(404).json({ error: 'Vehículo no encontrado' });
  const t = validarTecnico(req.body || {});
  if (t.error) return res.status(400).json({ error: t.error });
  const info = db.prepare(`
    INSERT INTO datos_tecnicos (vehiculo_id, tipo, codigo, marca, notas)
    VALUES (@vehiculo_id, @tipo, @codigo, @marca, @notas)
  `).run({ ...t.datos, vehiculo_id: vehiculo.id });
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.put('/api/tecnicos/:id', requiereLogin, requierePermiso('editar_vehiculos'), (req, res) => {
  const t = validarTecnico(req.body || {});
  if (t.error) return res.status(400).json({ error: t.error });
  const info = db.prepare('UPDATE datos_tecnicos SET tipo=@tipo, codigo=@codigo, marca=@marca, notas=@notas WHERE id=@id')
    .run({ ...t.datos, id: req.params.id });
  if (info.changes === 0) return res.status(404).json({ error: 'Dato no encontrado' });
  res.json({ ok: true });
});

app.delete('/api/tecnicos/:id', requiereLogin, requierePermiso('editar_vehiculos'), (req, res) => {
  const info = db.prepare('DELETE FROM datos_tecnicos WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Dato no encontrado' });
  res.json({ ok: true });
});

// ---------- Contactos ----------
function validarContacto(body) {
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return { error: 'El nombre es obligatorio' };
  return {
    datos: {
      nombre,
      empresa: String(body.empresa || '').trim() || null,
      telefono: String(body.telefono || '').trim() || null,
      pais: String(body.pais || '').trim() || null,
      categoria: String(body.categoria || '').trim() || null,
      notas: String(body.notas || '').trim() || null
    }
  };
}

app.get('/api/contactos', requiereLogin, requierePermiso('ver_contactos'), (req, res) => {
  res.json(db.prepare('SELECT * FROM contactos ORDER BY nombre COLLATE NOCASE').all());
});

app.post('/api/contactos', requiereLogin, requierePermiso('editar_contactos'), (req, res) => {
  const c = validarContacto(req.body || {});
  if (c.error) return res.status(400).json({ error: c.error });
  const info = db.prepare(`
    INSERT INTO contactos (nombre, empresa, telefono, pais, categoria, notas)
    VALUES (@nombre, @empresa, @telefono, @pais, @categoria, @notas)
  `).run(c.datos);
  registrar(req, 'Contactos', 'Contacto agregado', `${c.datos.nombre}${c.datos.empresa ? ' · ' + c.datos.empresa : ''}`, 'ver_contactos', info.lastInsertRowid);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.put('/api/contactos/:id', requiereLogin, requierePermiso('editar_contactos'), (req, res) => {
  const c = validarContacto(req.body || {});
  if (c.error) return res.status(400).json({ error: c.error });
  const info = db.prepare(`
    UPDATE contactos SET nombre=@nombre, empresa=@empresa, telefono=@telefono, pais=@pais, categoria=@categoria, notas=@notas
    WHERE id=@id
  `).run({ ...c.datos, id: req.params.id });
  if (info.changes === 0) return res.status(404).json({ error: 'Contacto no encontrado' });
  res.json({ ok: true });
});

app.delete('/api/contactos/:id', requiereLogin, requierePermiso('editar_contactos'), (req, res) => {
  const info = db.prepare('DELETE FROM contactos WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Contacto no encontrado' });
  res.json({ ok: true });
});

// ---------- Nómina (personal) ----------
function validarEmpleado(body) {
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return { error: 'El nombre es obligatorio' };
  const datos = { nombre };
  ['dni_cuil', 'fecha_nacimiento', 'telefono', 'direccion', 'contacto_emergencia', 'puesto', 'fecha_ingreso', 'notas']
    .forEach((c) => { datos[c] = String(body[c] || '').trim() || null; });
  return { datos };
}

app.get('/api/empleados', requiereLogin, requierePermiso('ver_nomina'), (req, res) => {
  const incluirBajas = req.query.todos === '1';
  const filas = db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM documentos_empleado d WHERE d.empleado_id = e.id) AS cant_docs,
      (SELECT COUNT(*) FROM documentos_empleado d WHERE d.empleado_id = e.id AND d.vencimiento IS NOT NULL AND d.vencimiento < @hoy) AS docs_vencidos,
      (SELECT COUNT(*) FROM documentos_empleado d WHERE d.empleado_id = e.id AND d.vencimiento IS NOT NULL AND d.vencimiento >= @hoy AND d.vencimiento <= @en30) AS docs_por_vencer
    FROM empleados e
    ${incluirBajas ? '' : 'WHERE e.activo = 1'}
    ORDER BY e.nombre COLLATE NOCASE
  `).all({ hoy: hoyAR(), en30: hoyAR(30) });
  res.json(filas);
});

// Nombres activos para elegir chofer / receptor de vale
app.get('/api/empleados/opciones', requiereLogin, (req, res) => {
  if (!(tiene(req, 'ver_nomina') || tiene(req, 'editar_vehiculos') || tiene(req, 'cargar_vales'))) {
    return res.status(403).json({ error: 'No tenés permiso' });
  }
  res.json(db.prepare('SELECT id, nombre FROM empleados WHERE activo = 1 ORDER BY nombre COLLATE NOCASE').all());
});

app.get('/api/empleados/:id', requiereLogin, requierePermiso('ver_nomina'), (req, res) => {
  const empleado = db.prepare('SELECT * FROM empleados WHERE id = ?').get(req.params.id);
  if (!empleado) return res.status(404).json({ error: 'Persona no encontrada' });
  const documentos = db.prepare('SELECT * FROM documentos_empleado WHERE empleado_id = ? ORDER BY vencimiento IS NULL, vencimiento, tipo').all(empleado.id);
  res.json({ empleado, documentos });
});

app.post('/api/empleados', requiereLogin, requierePermiso('editar_nomina'), (req, res) => {
  const e = validarEmpleado(req.body || {});
  if (e.error) return res.status(400).json({ error: e.error });
  const info = db.prepare(`
    INSERT INTO empleados (nombre, dni_cuil, fecha_nacimiento, telefono, direccion, contacto_emergencia, puesto, fecha_ingreso, notas)
    VALUES (@nombre, @dni_cuil, @fecha_nacimiento, @telefono, @direccion, @contacto_emergencia, @puesto, @fecha_ingreso, @notas)
  `).run(e.datos);
  registrar(req, 'Nómina', 'Persona agregada', `${e.datos.nombre}${e.datos.puesto ? ' · ' + e.datos.puesto : ''}`, 'ver_nomina', info.lastInsertRowid);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.put('/api/empleados/:id', requiereLogin, requierePermiso('editar_nomina'), (req, res) => {
  const e = validarEmpleado(req.body || {});
  if (e.error) return res.status(400).json({ error: e.error });
  const info = db.prepare(`
    UPDATE empleados SET nombre=@nombre, dni_cuil=@dni_cuil, fecha_nacimiento=@fecha_nacimiento, telefono=@telefono,
      direccion=@direccion, contacto_emergencia=@contacto_emergencia, puesto=@puesto, fecha_ingreso=@fecha_ingreso, notas=@notas
    WHERE id=@id
  `).run({ ...e.datos, id: req.params.id });
  if (info.changes === 0) return res.status(404).json({ error: 'Persona no encontrada' });
  res.json({ ok: true });
});

// Baja lógica con fecha: el legajo se conserva siempre
app.patch('/api/empleados/:id/activo', requiereLogin, requierePermiso('editar_nomina'), (req, res) => {
  const activo = req.body && req.body.activo ? 1 : 0;
  const info = db.prepare('UPDATE empleados SET activo = ?, fecha_baja = ? WHERE id = ?')
    .run(activo, activo ? null : hoyAR(), req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Persona no encontrada' });
  res.json({ ok: true });
});

// Documentación del empleado
app.post('/api/empleados/:id/documentos', requiereLogin, requierePermiso('editar_nomina'), (req, res) => {
  subida.single('archivo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const emp = db.prepare('SELECT id FROM empleados WHERE id = ?').get(req.params.id);
    const tipo = String((req.body || {}).tipo || '').trim();
    if (!emp || !tipo) {
      if (req.file) borrarAdjunto(req.file.filename);
      return res.status(emp ? 400 : 404).json({ error: emp ? 'El tipo de documento es obligatorio' : 'Persona no encontrada' });
    }
    const venc = String(req.body.vencimiento || '').trim();
    const info = db.prepare('INSERT INTO documentos_empleado (empleado_id, tipo, vencimiento, archivo, notas) VALUES (?, ?, ?, ?, ?)')
      .run(emp.id, tipo, /^\d{4}-\d{2}-\d{2}$/.test(venc) ? venc : null, req.file ? req.file.filename : null, String(req.body.notas || '').trim() || null);
    res.json({ ok: true, id: info.lastInsertRowid });
  });
});

app.put('/api/documentos/:id', requiereLogin, requierePermiso('editar_nomina'), (req, res) => {
  subida.single('archivo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const actual = db.prepare('SELECT * FROM documentos_empleado WHERE id = ?').get(req.params.id);
    const tipo = String((req.body || {}).tipo || '').trim();
    if (!actual || !tipo) {
      if (req.file) borrarAdjunto(req.file.filename);
      return res.status(actual ? 400 : 404).json({ error: actual ? 'El tipo de documento es obligatorio' : 'Documento no encontrado' });
    }
    let archivo = actual.archivo;
    if (req.file) { borrarAdjunto(actual.archivo); archivo = req.file.filename; }
    const venc = String(req.body.vencimiento || '').trim();
    db.prepare('UPDATE documentos_empleado SET tipo=?, vencimiento=?, archivo=?, notas=? WHERE id=?')
      .run(tipo, /^\d{4}-\d{2}-\d{2}$/.test(venc) ? venc : null, archivo, String(req.body.notas || '').trim() || null, actual.id);
    res.json({ ok: true });
  });
});

app.delete('/api/documentos/:id', requiereLogin, requierePermiso('editar_nomina'), (req, res) => {
  const doc = db.prepare('SELECT * FROM documentos_empleado WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
  db.prepare('DELETE FROM documentos_empleado WHERE id = ?').run(doc.id);
  borrarAdjunto(doc.archivo);
  res.json({ ok: true });
});

// ---------- Gastos (seguimiento contable) ----------
function validarGasto(body) {
  const fecha = String(body.fecha || '').trim();
  const categoria = String(body.categoria || '').trim();
  const monto = parseFloat(body.monto);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: 'La fecha es obligatoria' };
  if (!categoria) return { error: 'La categoría es obligatoria' };
  if (!Number.isFinite(monto) || monto <= 0) return { error: 'El monto debe ser mayor a 0' };
  const vehiculoId = body.vehiculo_id ? parseInt(body.vehiculo_id, 10) : null;
  return {
    datos: {
      fecha, categoria, monto,
      descripcion: String(body.descripcion || '').trim() || null,
      vehiculo_id: Number.isFinite(vehiculoId) ? vehiculoId : null
    }
  };
}

app.get('/api/gastos', requiereLogin, requierePermiso('ver_gastos'), (req, res) => {
  const mes = String(req.query.mes || '');
  if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: 'Mes inválido' });
  const manual = db.prepare(`
    SELECT g.id, g.fecha, g.categoria, g.descripcion, g.monto, g.comprobante_archivo, g.vehiculo_id,
      ve.patente, ve.marca AS v_marca, ve.modelo AS v_modelo, 'gasto' AS origen
    FROM gastos g LEFT JOIN vehiculos ve ON ve.id = g.vehiculo_id
    WHERE g.fecha >= ? AND g.fecha < ?
  `).all(...rangoMes(mes));
  const combustible = db.prepare(`
    SELECT va.id, va.fecha, 'Combustible' AS categoria,
      (COALESCE(va.tipo_combustible,'Combustible') || COALESCE(' '||va.grado,'') || ' · ' || va.litros || ' L') AS descripcion,
      va.monto, va.foto_archivo AS comprobante_archivo, va.vehiculo_id,
      ve.patente, ve.marca AS v_marca, ve.modelo AS v_modelo, 'vale' AS origen
    FROM vales va JOIN vehiculos ve ON ve.id = va.vehiculo_id
    WHERE va.fecha >= ? AND va.fecha < ? AND va.monto IS NOT NULL
  `).all(...rangoMes(mes));
  const filas = [...manual, ...combustible].sort((a, b) => b.fecha < a.fecha ? -1 : b.fecha > a.fecha ? 1 : b.id - a.id);
  res.json(filas);
});

app.get('/api/gastos/resumen', requiereLogin, requierePermiso('ver_totales_gastos'), (req, res) => {
  const anio = String(req.query.anio || '');
  if (!/^\d{4}$/.test(anio)) return res.status(400).json({ error: 'Año inválido' });
  // Gastos manuales + combustible (vales con monto), combinados
  const desde = `${anio}-01-01`, hasta = `${anio}-12-31`;
  const gMes = db.prepare(`SELECT substr(fecha,1,7) AS mes, SUM(monto) AS total, COUNT(*) AS cantidad FROM gastos WHERE fecha >= ? AND fecha <= ? GROUP BY mes`).all(desde, hasta);
  const vMes = db.prepare(`SELECT substr(fecha,1,7) AS mes, SUM(monto) AS total, COUNT(*) AS cantidad FROM vales WHERE fecha >= ? AND fecha <= ? AND monto IS NOT NULL GROUP BY mes`).all(desde, hasta);
  const mapaMes = {};
  [...gMes, ...vMes].forEach((r) => {
    if (!mapaMes[r.mes]) mapaMes[r.mes] = { mes: r.mes, total: 0, cantidad: 0 };
    mapaMes[r.mes].total += r.total; mapaMes[r.mes].cantidad += r.cantidad;
  });
  const porMes = Object.values(mapaMes).sort((a, b) => a.mes < b.mes ? -1 : 1);

  const gCat = db.prepare(`SELECT categoria, SUM(monto) AS total FROM gastos WHERE fecha >= ? AND fecha <= ? GROUP BY categoria`).all(desde, hasta);
  const vCombustible = db.prepare(`SELECT COALESCE(SUM(monto),0) AS total FROM vales WHERE fecha >= ? AND fecha <= ? AND monto IS NOT NULL`).get(desde, hasta).total;
  const mapaCat = {};
  gCat.forEach((c) => { mapaCat[c.categoria] = (mapaCat[c.categoria] || 0) + c.total; });
  if (vCombustible > 0) mapaCat['Combustible'] = (mapaCat['Combustible'] || 0) + vCombustible;
  const porCategoria = Object.entries(mapaCat).map(([categoria, total]) => ({ categoria, total })).sort((a, b) => b.total - a.total);

  const total = porMes.reduce((s, m) => s + m.total, 0);
  res.json({ anio, total, por_mes: porMes, por_categoria: porCategoria });
});

app.post('/api/gastos', requiereLogin, requierePermiso('cargar_gastos'), (req, res) => {
  subida.single('comprobante')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const g = validarGasto(req.body || {});
    if (g.error) {
      if (req.file) borrarAdjunto(req.file.filename);
      return res.status(400).json({ error: g.error });
    }
    const info = db.prepare(`
      INSERT INTO gastos (fecha, categoria, descripcion, monto, vehiculo_id, comprobante_archivo, creado_por)
      VALUES (@fecha, @categoria, @descripcion, @monto, @vehiculo_id, @comprobante_archivo, @creado_por)
    `).run({ ...g.datos, comprobante_archivo: req.file ? req.file.filename : null, creado_por: req.usuario.username });
    registrar(req, 'Contable', 'Gasto registrado', `${g.datos.categoria} · $${g.datos.monto}${g.datos.descripcion ? ' · ' + g.datos.descripcion : ''}`, 'ver_gastos', info.lastInsertRowid);
    res.json({ ok: true, id: info.lastInsertRowid });
  });
});

app.put('/api/gastos/:id', requiereLogin, requierePermiso('cargar_gastos'), (req, res) => {
  subida.single('comprobante')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const actual = db.prepare('SELECT * FROM gastos WHERE id = ?').get(req.params.id);
    if (!actual) {
      if (req.file) borrarAdjunto(req.file.filename);
      return res.status(404).json({ error: 'Gasto no encontrado' });
    }
    const g = validarGasto(req.body || {});
    if (g.error) {
      if (req.file) borrarAdjunto(req.file.filename);
      return res.status(400).json({ error: g.error });
    }
    let comprobante = actual.comprobante_archivo;
    if (req.file) {
      borrarAdjunto(actual.comprobante_archivo);
      comprobante = req.file.filename;
    }
    db.prepare(`
      UPDATE gastos SET fecha=@fecha, categoria=@categoria, descripcion=@descripcion, monto=@monto,
        vehiculo_id=@vehiculo_id, comprobante_archivo=@comprobante_archivo
      WHERE id=@id
    `).run({ ...g.datos, comprobante_archivo: comprobante, id: actual.id });
    res.json({ ok: true });
  });
});

app.delete('/api/gastos/:id', requiereLogin, requierePermiso('cargar_gastos'), (req, res) => {
  const gasto = db.prepare('SELECT * FROM gastos WHERE id = ?').get(req.params.id);
  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });
  db.prepare('DELETE FROM gastos WHERE id = ?').run(gasto.id);
  borrarAdjunto(gasto.comprobante_archivo);
  res.json({ ok: true });
});

// ---------- Vales de combustible ----------
app.get('/api/vales', requiereLogin, requierePermiso('ver_vales'), (req, res) => {
  const cond = [];
  const params = {};
  if (req.query.vehiculo) { cond.push('va.vehiculo_id = @vehiculo'); params.vehiculo = req.query.vehiculo; }
  if (req.query.desde) { cond.push('va.fecha >= @desde'); params.desde = req.query.desde; }
  if (req.query.hasta) { cond.push('va.fecha <= @hasta'); params.hasta = req.query.hasta; }
  const stmt = db.prepare(`
    SELECT va.*, ve.marca, ve.modelo, ve.patente
    FROM vales va JOIN vehiculos ve ON ve.id = va.vehiculo_id
    ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
    ORDER BY va.fecha DESC, va.id DESC
  `);
  res.json(cond.length ? stmt.all(params) : stmt.all());
});

app.post('/api/vales', requiereLogin, requierePermiso('cargar_vales'), (req, res) => {
  subida.single('foto')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const { vehiculo_id, fecha, litros, numero_vale, receptor, observaciones, tipo_combustible, grado } = req.body || {};
    const litrosNum = parseFloat(litros);
    if (!vehiculo_id || !fecha || !Number.isFinite(litrosNum) || litrosNum <= 0) {
      if (req.file) borrarAdjunto(req.file.filename);
      return res.status(400).json({ error: 'Vehículo, fecha y litros (mayor a 0) son obligatorios' });
    }
    const vehiculo = db.prepare('SELECT id FROM vehiculos WHERE id = ?').get(vehiculo_id);
    if (!vehiculo) {
      if (req.file) borrarAdjunto(req.file.filename);
      return res.status(400).json({ error: 'El vehículo seleccionado no existe' });
    }
    const montoNum = parseFloat(req.body.monto);
    const info = db.prepare(`
      INSERT INTO vales (vehiculo_id, fecha, litros, numero_vale, receptor, observaciones, foto_archivo, tipo_combustible, grado, monto)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vehiculo_id, fecha, litrosNum,
      String(numero_vale || '').trim() || null,
      String(receptor || '').trim() || null,
      String(observaciones || '').trim() || null,
      req.file ? req.file.filename : null,
      String(tipo_combustible || '').trim() || null,
      String(grado || '').trim() || null,
      Number.isFinite(montoNum) && montoNum > 0 ? montoNum : null
    );
    const patente = db.prepare('SELECT patente FROM vehiculos WHERE id = ?').get(vehiculo_id).patente;
    registrar(req, 'Combustible', 'Vale registrado', `${patente} · ${litrosNum} L${Number.isFinite(montoNum) && montoNum > 0 ? ' · $' + montoNum : ''}`, 'ver_vales', info.lastInsertRowid);
    res.json({ ok: true, id: info.lastInsertRowid });
  });
});

app.delete('/api/vales/:id', requiereLogin, requierePermiso('cargar_vales'), (req, res) => {
  const vale = db.prepare('SELECT * FROM vales WHERE id = ?').get(req.params.id);
  if (!vale) return res.status(404).json({ error: 'Vale no encontrado' });
  db.prepare('DELETE FROM vales WHERE id = ?').run(vale.id);
  borrarAdjunto(vale.foto_archivo);
  res.json({ ok: true });
});

// Los adjuntos solo se sirven a usuarios logueados
app.get('/uploads/:archivo', requiereLogin, (req, res) => {
  const nombre = path.basename(req.params.archivo);
  const ruta = path.join(UPLOADS_DIR, nombre);
  if (!fs.existsSync(ruta)) return res.status(404).send('No encontrado');
  res.sendFile(ruta);
});

// ---------- Pañol (stock del depósito) ----------
function validarItemPanol(body) {
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return { error: 'El nombre del material es obligatorio' };
  const cantidad = parseFloat(body.cantidad);
  const minimo = parseFloat(body.minimo);
  const fecha = String(body.fecha_ingreso || '').trim();
  return {
    datos: {
      nombre,
      descripcion: String(body.descripcion || '').trim() || null,
      cantidad: Number.isFinite(cantidad) && cantidad >= 0 ? Math.round(cantidad) : 0,
      unidad: String(body.unidad || '').trim() || null,
      minimo: Number.isFinite(minimo) && minimo >= 0 ? Math.round(minimo) : null,
      ubicacion: String(body.ubicacion || '').trim() || null,
      fecha_ingreso: /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : hoyAR()
    }
  };
}

app.get('/api/panol', requiereLogin, requierePermiso('ver_panol'), (req, res) => {
  const incluirInactivos = req.query.todos === '1';
  res.json(db.prepare(`SELECT * FROM panol_items ${incluirInactivos ? '' : 'WHERE activo = 1'} ORDER BY nombre COLLATE NOCASE`).all());
});

app.get('/api/panol/:id', requiereLogin, requierePermiso('ver_panol'), (req, res) => {
  const item = db.prepare('SELECT * FROM panol_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Material no encontrado' });
  const movimientos = db.prepare('SELECT * FROM panol_movimientos WHERE item_id = ? ORDER BY id DESC LIMIT 50').all(item.id);
  res.json({ item, movimientos });
});

app.post('/api/panol', requiereLogin, requierePermiso('editar_panol'), (req, res) => {
  const m = validarItemPanol(req.body || {});
  if (m.error) return res.status(400).json({ error: m.error });
  const info = db.prepare(`
    INSERT INTO panol_items (nombre, descripcion, cantidad, unidad, minimo, ubicacion, fecha_ingreso)
    VALUES (@nombre, @descripcion, @cantidad, @unidad, @minimo, @ubicacion, @fecha_ingreso)
  `).run(m.datos);
  if (m.datos.cantidad > 0) {
    db.prepare('INSERT INTO panol_movimientos (item_id, fecha, delta, cantidad_final, motivo, usuario) VALUES (?, ?, ?, ?, ?, ?)')
      .run(info.lastInsertRowid, hoyAR(), m.datos.cantidad, m.datos.cantidad, 'Carga inicial', req.usuario.username);
  }
  registrar(req, 'Pañol', 'Material agregado',
    `${m.datos.nombre} · ${m.datos.cantidad}${m.datos.unidad ? ' ' + m.datos.unidad : ''}`, 'ver_panol', info.lastInsertRowid);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.put('/api/panol/:id', requiereLogin, requierePermiso('editar_panol'), (req, res) => {
  const actual = db.prepare('SELECT * FROM panol_items WHERE id = ?').get(req.params.id);
  if (!actual) return res.status(404).json({ error: 'Material no encontrado' });
  const m = validarItemPanol(req.body || {});
  if (m.error) return res.status(400).json({ error: m.error });
  // La cantidad no se toca acá: se ajusta con las flechitas para que quede historial
  db.prepare(`
    UPDATE panol_items SET nombre=@nombre, descripcion=@descripcion, unidad=@unidad,
      minimo=@minimo, ubicacion=@ubicacion, fecha_ingreso=@fecha_ingreso WHERE id=@id
  `).run({ ...m.datos, id: actual.id });
  registrar(req, 'Pañol', 'Material editado', m.datos.nombre, 'ver_panol', actual.id);
  res.json({ ok: true });
});

// Ajuste de stock: acepta la cantidad final (cantidad) o un ajuste relativo (delta)
app.post('/api/panol/:id/movimiento', requiereLogin, requierePermiso('editar_panol'), (req, res) => {
  const item = db.prepare('SELECT * FROM panol_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Material no encontrado' });
  const body = req.body || {};
  let delta;
  if (body.cantidad !== undefined && body.cantidad !== null && body.cantidad !== '') {
    const cantidadFinal = Math.round(parseFloat(body.cantidad));
    if (!Number.isFinite(cantidadFinal) || cantidadFinal < 0) return res.status(400).json({ error: 'La cantidad no puede ser negativa' });
    delta = cantidadFinal - item.cantidad;
  } else {
    delta = Math.round(parseFloat(body.delta));
  }
  if (!Number.isFinite(delta)) return res.status(400).json({ error: 'Cantidad inválida' });
  if (delta === 0) return res.json({ ok: true, cantidad: item.cantidad, sin_cambios: true });
  const nueva = item.cantidad + delta;
  if (nueva < 0) return res.status(400).json({ error: `No hay stock suficiente (hay ${item.cantidad})` });
  const motivo = String(body.motivo || '').trim() || null;
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE panol_items SET cantidad = ? WHERE id = ?').run(nueva, item.id);
    db.prepare('INSERT INTO panol_movimientos (item_id, fecha, delta, cantidad_final, motivo, usuario) VALUES (?, ?, ?, ?, ?, ?)')
      .run(item.id, hoyAR(), delta, nueva, motivo, req.usuario.username);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  registrar(req, 'Pañol', delta > 0 ? 'Ingreso de material' : 'Salida de material',
    `${item.nombre}: ${delta > 0 ? '+' : ''}${delta}${item.unidad ? ' ' + item.unidad : ''} → quedan ${nueva}${motivo ? ' · ' + motivo : ''}`,
    'ver_panol', item.id);
  res.json({ ok: true, cantidad: nueva });
});

app.patch('/api/panol/:id/activo', requiereLogin, requierePermiso('editar_panol'), (req, res) => {
  const activo = req.body && req.body.activo ? 1 : 0;
  const item = db.prepare('SELECT nombre FROM panol_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Material no encontrado' });
  db.prepare('UPDATE panol_items SET activo = ? WHERE id = ?').run(activo, req.params.id);
  registrar(req, 'Pañol', activo ? 'Material reactivado' : 'Material dado de baja', item.nombre, 'ver_panol', Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Actualizaciones (novedades del sistema) ----------
function novedadesVisibles(req, limite) {
  return db.prepare('SELECT * FROM actividad ORDER BY id DESC LIMIT 400').all()
    .filter((f) => !f.permiso || (f.permiso === 'ver_usuarios_actividad' ? req.usuario.rol === 'admin' : tiene(req, f.permiso)))
    .slice(0, limite);
}

app.get('/api/actualizaciones', requiereLogin, (req, res) => {
  const limite = Math.min(parseInt(req.query.limite, 10) || 60, 200);
  res.json(novedadesVisibles(req, limite));
});

// ---------- Panel ----------
app.get('/api/dashboard', requiereLogin, (req, res) => {
  // Se puede consultar cualquier mes: al cambiar de mes no se "pierden" los datos
  const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes || '')) ? req.query.mes : hoyAR().slice(0, 7);
  const [desde, hasta] = rangoMes(mes);
  const anio = mes.slice(0, 4);
  const enero = `${anio}-01-01`, diciembre = `${anio}-12-31`;
  const d = { mes };
  if (tiene(req, 'ver_vehiculos')) {
    d.vehiculos_activos = db.prepare('SELECT COUNT(*) AS n FROM vehiculos WHERE activo = 1').get().n;
  }
  if (tiene(req, 'ver_vales')) {
    d.vales_mes = db.prepare('SELECT COUNT(*) AS n FROM vales WHERE fecha >= ? AND fecha < ?').get(desde, hasta).n;
    d.ultimos_vales = db.prepare(`
      SELECT va.*, ve.marca, ve.modelo, ve.patente
      FROM vales va JOIN vehiculos ve ON ve.id = va.vehiculo_id
      WHERE va.fecha >= ? AND va.fecha < ?
      ORDER BY va.fecha DESC, va.id DESC LIMIT 8
    `).all(desde, hasta);
  }
  if (tiene(req, 'ver_totales_litros')) {
    d.litros_mes = db.prepare('SELECT COALESCE(SUM(litros), 0) AS n FROM vales WHERE fecha >= ? AND fecha < ?').get(desde, hasta).n;
    d.litros_anio = db.prepare('SELECT COALESCE(SUM(litros), 0) AS n FROM vales WHERE fecha >= ? AND fecha <= ?').get(enero, diciembre).n;
    d.top_vehiculos_mes = db.prepare(`
      SELECT ve.marca, ve.modelo, ve.patente, SUM(va.litros) AS litros
      FROM vales va JOIN vehiculos ve ON ve.id = va.vehiculo_id
      WHERE va.fecha >= ? AND va.fecha < ?
      GROUP BY va.vehiculo_id ORDER BY litros DESC LIMIT 5
    `).all(desde, hasta);
    d.litros_por_mes = db.prepare(`
      SELECT substr(fecha, 1, 7) AS mes, SUM(litros) AS litros
      FROM vales WHERE fecha >= ? AND fecha <= ? GROUP BY mes ORDER BY mes
    `).all(enero, diciembre);
  }
  if (tiene(req, 'ver_panol')) {
    d.panol_bajo_minimo = db.prepare('SELECT COUNT(*) AS n FROM panol_items WHERE activo = 1 AND minimo IS NOT NULL AND cantidad <= minimo').get().n;
  }
  d.novedades = novedadesVisibles(req, 6);
  res.json(d);
});

// ---------- Operaciones · Reporte diario ----------
app.get('/api/reportes', requiereLogin, (req, res) => {
  res.json(db.prepare('SELECT * FROM reportes_diarios ORDER BY fecha DESC, id DESC').all());
});

app.post('/api/reportes', requiereLogin, (req, res) => {
  subida.single('archivo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const fecha = String((req.body || {}).fecha || '').trim() || hoyAR();
    if (!req.file || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      if (req.file) borrarAdjunto(req.file.filename);
      return res.status(400).json({ error: req.file ? 'La fecha es inválida' : 'Adjuntá el reporte' });
    }
    const info = db.prepare('INSERT INTO reportes_diarios (fecha, archivo, creado_por) VALUES (?, ?, ?)')
      .run(fecha, req.file.filename, req.usuario.username);
    registrar(req, 'Operaciones', 'Reporte diario cargado', `del ${fecha}`, null, info.lastInsertRowid);
    res.json({ ok: true, id: info.lastInsertRowid });
  });
});

app.delete('/api/reportes/:id', requiereLogin, (req, res) => {
  const reporte = db.prepare('SELECT * FROM reportes_diarios WHERE id = ?').get(req.params.id);
  if (!reporte) return res.status(404).json({ error: 'Reporte no encontrado' });
  db.prepare('DELETE FROM reportes_diarios WHERE id = ?').run(reporte.id);
  borrarAdjunto(reporte.archivo);
  res.json({ ok: true });
});

// ---------- Operaciones · Módulos habitacionales ----------
const ESTADOS_MODULO = ['Pendiente', 'En reparación', 'Terminado', 'Entregado'];

function numeroONull(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function avanceValido(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}
function textoONull(v) {
  const t = String(v ?? '').trim();
  return t || null;
}

// Inventario
app.get('/api/modulos', requiereLogin, (req, res) => {
  const incluirBajas = req.query.inactivos === '1';
  const modulos = db.prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM modulo_fotos f WHERE f.modulo_id = m.id) AS fotos
    FROM modulos m ${incluirBajas ? '' : 'WHERE m.activo = 1'}
    ORDER BY m.activo DESC, m.bien_capital COLLATE NOCASE
  `).all();
  res.json(modulos);
});

// Resumen para el cronograma: avance general y por módulo
app.get('/api/modulos/resumen', requiereLogin, (req, res) => {
  const modulos = db.prepare('SELECT id, bien_capital, tipo, estado, avance, fecha_objetivo FROM modulos WHERE activo = 1 ORDER BY bien_capital COLLATE NOCASE').all();
  // El avance total es el promedio sobre el total de módulos activos
  const total = modulos.length
    ? Math.round(modulos.reduce((suma, m) => suma + m.avance, 0) / modulos.length)
    : 0;
  res.json({ avance_total: total, cantidad: modulos.length, modulos });
});

app.get('/api/modulos/:id', requiereLogin, (req, res) => {
  const modulo = db.prepare('SELECT * FROM modulos WHERE id = ?').get(req.params.id);
  if (!modulo) return res.status(404).json({ error: 'Módulo no encontrado' });
  modulo.fotos = db.prepare('SELECT * FROM modulo_fotos WHERE modulo_id = ? ORDER BY id DESC').all(modulo.id);
  modulo.partes = db.prepare('SELECT * FROM partes_diarios WHERE modulo_id = ? ORDER BY fecha DESC, id DESC').all(modulo.id);
  for (const p of modulo.partes) {
    p.fotos = db.prepare('SELECT * FROM parte_fotos WHERE parte_id = ?').all(p.id);
  }
  modulo.documentos = db.prepare('SELECT * FROM documentos_modulo WHERE modulo_id = ? ORDER BY id DESC').all(modulo.id);
  res.json(modulo);
});

function datosModulo(body) {
  const bien = String(body.bien_capital || '').trim();
  if (!bien) return { error: 'El número de bien de capital es obligatorio' };
  const estado = ESTADOS_MODULO.includes(body.estado) ? body.estado : 'Pendiente';
  const objetivo = String(body.fecha_objetivo || '').trim();
  return {
    datos: {
      bien_capital: bien,
      tipo: textoONull(body.tipo),
      largo: numeroONull(body.largo),
      ancho: numeroONull(body.ancho),
      alto: numeroONull(body.alto),
      cliente: textoONull(body.cliente),
      ubicacion: textoONull(body.ubicacion),
      estado,
      fecha_objetivo: /^\d{4}-\d{2}-\d{2}$/.test(objetivo) ? objetivo : null,
      notas: textoONull(body.notas)
    }
  };
}

app.post('/api/modulos', requiereLogin, (req, res) => {
  const { error, datos } = datosModulo(req.body || {});
  if (error) return res.status(400).json({ error });
  try {
    const info = db.prepare(`
      INSERT INTO modulos (bien_capital, tipo, largo, ancho, alto, cliente, ubicacion, estado, fecha_objetivo, notas)
      VALUES (@bien_capital, @tipo, @largo, @ancho, @alto, @cliente, @ubicacion, @estado, @fecha_objetivo, @notas)
    `).run(datos);
    registrar(req, 'Operaciones', 'Módulo agregado', datos.bien_capital, null, info.lastInsertRowid);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: String(e.message).includes('UNIQUE') ? 'Ya existe un módulo con ese número de bien de capital' : 'No se pudo guardar el módulo' });
  }
});

app.put('/api/modulos/:id', requiereLogin, (req, res) => {
  const { error, datos } = datosModulo(req.body || {});
  if (error) return res.status(400).json({ error });
  try {
    const info = db.prepare(`
      UPDATE modulos SET bien_capital=@bien_capital, tipo=@tipo, largo=@largo, ancho=@ancho, alto=@alto,
        cliente=@cliente, ubicacion=@ubicacion, estado=@estado, fecha_objetivo=@fecha_objetivo, notas=@notas
      WHERE id=@id
    `).run({ ...datos, id: Number(req.params.id) });
    if (info.changes === 0) return res.status(404).json({ error: 'Módulo no encontrado' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e.message).includes('UNIQUE') ? 'Ya existe un módulo con ese número de bien de capital' : 'No se pudo guardar el módulo' });
  }
});

// Baja lógica: el módulo deja de aparecer pero conserva su historial
app.post('/api/modulos/:id/activo', requiereLogin, (req, res) => {
  const activo = req.body && req.body.activo ? 1 : 0;
  const info = db.prepare('UPDATE modulos SET activo = ? WHERE id = ?').run(activo, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Módulo no encontrado' });
  res.json({ ok: true });
});

// Fotos del módulo
app.post('/api/modulos/:id/fotos', requiereLogin, (req, res) => {
  subida.array('fotos', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const modulo = db.prepare('SELECT id FROM modulos WHERE id = ?').get(req.params.id);
    if (!modulo || !req.files || !req.files.length) {
      (req.files || []).forEach((f) => borrarAdjunto(f.filename));
      return res.status(modulo ? 400 : 404).json({ error: modulo ? 'Elegí al menos una foto' : 'Módulo no encontrado' });
    }
    const desc = textoONull((req.body || {}).descripcion);
    const insertar = db.prepare('INSERT INTO modulo_fotos (modulo_id, archivo, descripcion) VALUES (?, ?, ?)');
    req.files.forEach((f) => insertar.run(modulo.id, f.filename, desc));
    res.json({ ok: true, cantidad: req.files.length });
  });
});

app.delete('/api/modulo-fotos/:id', requiereLogin, (req, res) => {
  const foto = db.prepare('SELECT * FROM modulo_fotos WHERE id = ?').get(req.params.id);
  if (!foto) return res.status(404).json({ error: 'Foto no encontrada' });
  db.prepare('DELETE FROM modulo_fotos WHERE id = ?').run(foto.id);
  borrarAdjunto(foto.archivo);
  res.json({ ok: true });
});

// Seguimiento de reparación: partes de trabajo por día
app.get('/api/partes', requiereLogin, (req, res) => {
  const fecha = String(req.query.fecha || '').trim();
  const filtrarFecha = /^\d{4}-\d{2}-\d{2}$/.test(fecha);
  const partes = db.prepare(`
    SELECT p.*, m.bien_capital, m.tipo AS modulo_tipo
    FROM partes_diarios p JOIN modulos m ON m.id = p.modulo_id
    ${filtrarFecha ? 'WHERE p.fecha = ?' : ''}
    ORDER BY p.fecha DESC, p.id DESC ${filtrarFecha ? '' : 'LIMIT 200'}
  `).all(...(filtrarFecha ? [fecha] : []));
  for (const p of partes) {
    p.fotos = db.prepare('SELECT * FROM parte_fotos WHERE parte_id = ?').all(p.id);
  }
  res.json({ hoy: hoyAR(), partes });
});

// Días con trabajo cargado, para pintar el calendario del cronograma
app.get('/api/partes/calendario', requiereLogin, (req, res) => {
  const mes = String(req.query.mes || '').trim();
  if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: 'Mes inválido' });
  const [desde, hasta] = rangoMes(mes);
  const dias = db.prepare(`
    SELECT fecha, COUNT(*) AS partes, COUNT(DISTINCT modulo_id) AS modulos
    FROM partes_diarios WHERE fecha >= ? AND fecha < ? GROUP BY fecha
  `).all(desde, hasta);
  const objetivos = db.prepare(`
    SELECT fecha_objetivo AS fecha, bien_capital FROM modulos
    WHERE activo = 1 AND fecha_objetivo >= ? AND fecha_objetivo < ?
  `).all(desde, hasta);
  res.json({ hoy: hoyAR(), dias, objetivos });
});

app.post('/api/partes', requiereLogin, (req, res) => {
  subida.array('fotos', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const body = req.body || {};
    const limpiar = () => (req.files || []).forEach((f) => borrarAdjunto(f.filename));
    const fecha = String(body.fecha || '').trim() || hoyAR();
    const moduloId = parseInt(body.modulo_id, 10);
    const actividades = String(body.actividades || '').trim();
    const modulo = db.prepare('SELECT id FROM modulos WHERE id = ?').get(moduloId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !modulo || !actividades) {
      limpiar();
      return res.status(400).json({ error: !modulo ? 'Elegí el módulo en el que se trabajó' : (!actividades ? 'Contá qué actividades se realizaron' : 'La fecha es inválida') });
    }
    const avance = avanceValido(body.avance);
    const info = db.prepare(`
      INSERT INTO partes_diarios (fecha, modulo_id, actividades, responsable, avance, notas, creado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(fecha, modulo.id, actividades, textoONull(body.responsable), avance, textoONull(body.notas), req.usuario.username);
    const parteId = info.lastInsertRowid;
    const insertarFoto = db.prepare('INSERT INTO parte_fotos (parte_id, archivo) VALUES (?, ?)');
    (req.files || []).forEach((f) => insertarFoto.run(parteId, f.filename));
    // El avance del parte pasa a ser el avance actual del módulo
    if (avance !== null) db.prepare('UPDATE modulos SET avance = ? WHERE id = ?').run(avance, modulo.id);
    registrar(req, 'Operaciones', 'Parte diario cargado',
      `${modulo.bien_capital}${avance !== null ? ` · avance ${avance}%` : ''}`, null, parteId);
    res.json({ ok: true, id: parteId });
  });
});

app.delete('/api/partes/:id', requiereLogin, (req, res) => {
  const parte = db.prepare('SELECT * FROM partes_diarios WHERE id = ?').get(req.params.id);
  if (!parte) return res.status(404).json({ error: 'Parte no encontrado' });
  const fotos = db.prepare('SELECT * FROM parte_fotos WHERE parte_id = ?').all(parte.id);
  db.prepare('DELETE FROM parte_fotos WHERE parte_id = ?').run(parte.id);
  db.prepare('DELETE FROM partes_diarios WHERE id = ?').run(parte.id);
  fotos.forEach((f) => borrarAdjunto(f.archivo));
  res.json({ ok: true });
});

// El avance del módulo también se puede corregir a mano desde la barra
app.post('/api/modulos/:id/avance', requiereLogin, (req, res) => {
  const avance = avanceValido((req.body || {}).avance);
  if (avance === null) return res.status(400).json({ error: 'El avance debe ser un número entre 0 y 100' });
  const info = db.prepare('UPDATE modulos SET avance = ? WHERE id = ?').run(avance, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Módulo no encontrado' });
  res.json({ ok: true, avance });
});

// Materiales
const ESTADOS_MATERIAL = ['Pedido', 'Comprado'];

app.get('/api/materiales', requiereLogin, (req, res) => {
  const filas = db.prepare(`
    SELECT * FROM materiales
    ${req.query.inactivos === '1' ? '' : 'WHERE activo = 1'}
    ORDER BY activo DESC, fecha DESC, id DESC
  `).all();
  res.json(filas);
});

function datosMaterial(body) {
  const descripcion = String(body.descripcion || '').trim();
  if (!descripcion) return { error: 'Escribí qué material es' };
  const fecha = String(body.fecha || '').trim() || hoyAR();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: 'La fecha es inválida' };
  return {
    datos: {
      destino: textoONull(body.destino),
      fecha, descripcion,
      cantidad: numeroONull(body.cantidad),
      unidad: textoONull(body.unidad),
      estado: ESTADOS_MATERIAL.includes(body.estado) ? body.estado : 'Pedido',
      notas: textoONull(body.notas)
    }
  };
}

app.post('/api/materiales', requiereLogin, (req, res) => {
  subida.single('comprobante')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const { error, datos } = datosMaterial(req.body || {});
    if (error) {
      if (req.file) borrarAdjunto(req.file.filename);
      return res.status(400).json({ error });
    }
    const info = db.prepare(`
      INSERT INTO materiales (destino, fecha, descripcion, cantidad, unidad, estado, notas, comprobante_archivo)
      VALUES (@destino, @fecha, @descripcion, @cantidad, @unidad, @estado, @notas, @comprobante_archivo)
    `).run({ ...datos, comprobante_archivo: req.file ? req.file.filename : null });
    registrar(req, 'Operaciones', `Material ${String(datos.estado || '').toLowerCase() === 'comprado' ? 'comprado' : 'pedido'}`,
      `${datos.descripcion}${datos.cantidad ? ` · ${datos.cantidad}${datos.unidad ? ' ' + datos.unidad : ''}` : ''}${datos.destino ? ` · ${datos.destino}` : ''}`,
      null, info.lastInsertRowid);
    res.json({ ok: true, id: info.lastInsertRowid });
  });
});

app.put('/api/materiales/:id', requiereLogin, (req, res) => {
  subida.single('comprobante')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const actual = db.prepare('SELECT * FROM materiales WHERE id = ?').get(req.params.id);
    if (!actual) {
      if (req.file) borrarAdjunto(req.file.filename);
      return res.status(404).json({ error: 'Material no encontrado' });
    }
    const { error, datos } = datosMaterial(req.body || {});
    if (error) {
      if (req.file) borrarAdjunto(req.file.filename);
      return res.status(400).json({ error });
    }
    let comprobante = actual.comprobante_archivo;
    if (req.file) { borrarAdjunto(actual.comprobante_archivo); comprobante = req.file.filename; }
    else if (req.body.quitar_comprobante === '1') { borrarAdjunto(actual.comprobante_archivo); comprobante = null; }
    db.prepare(`
      UPDATE materiales SET destino=@destino, fecha=@fecha, descripcion=@descripcion, cantidad=@cantidad,
        unidad=@unidad, estado=@estado, notas=@notas, comprobante_archivo=@comprobante_archivo
      WHERE id=@id
    `).run({ ...datos, comprobante_archivo: comprobante, id: actual.id });
    res.json({ ok: true });
  });
});

app.post('/api/materiales/:id/estado', requiereLogin, (req, res) => {
  const estado = (req.body || {}).estado;
  if (!ESTADOS_MATERIAL.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  const info = db.prepare('UPDATE materiales SET estado = ? WHERE id = ?').run(estado, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Material no encontrado' });
  res.json({ ok: true });
});

// Baja lógica: el material deja de aparecer pero queda el registro de lo pedido
app.post('/api/materiales/:id/activo', requiereLogin, (req, res) => {
  const activo = req.body && req.body.activo ? 1 : 0;
  const info = db.prepare('UPDATE materiales SET activo = ? WHERE id = ?').run(activo, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Material no encontrado' });
  res.json({ ok: true });
});

// Documentación
app.get('/api/documentos-modulo', requiereLogin, (req, res) => {
  const moduloId = parseInt(req.query.modulo_id, 10);
  const filtrar = Number.isFinite(moduloId);
  const filas = db.prepare(`
    SELECT d.*, m.bien_capital FROM documentos_modulo d
    LEFT JOIN modulos m ON m.id = d.modulo_id
    ${filtrar ? 'WHERE d.modulo_id = ?' : ''}
    ORDER BY d.id DESC
  `).all(...(filtrar ? [moduloId] : []));
  res.json(filas);
});

app.post('/api/documentos-modulo', requiereLogin, (req, res) => {
  subida.single('archivo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const body = req.body || {};
    const tipo = String(body.tipo || '').trim();
    if (!tipo || !req.file) {
      if (req.file) borrarAdjunto(req.file.filename);
      return res.status(400).json({ error: tipo ? 'Adjuntá el archivo' : 'Elegí el tipo de documento' });
    }
    const moduloId = parseInt(body.modulo_id, 10);
    const info = db.prepare('INSERT INTO documentos_modulo (modulo_id, tipo, titulo, archivo, notas) VALUES (?, ?, ?, ?, ?)')
      .run(Number.isFinite(moduloId) ? moduloId : null, tipo, textoONull(body.titulo), req.file.filename, textoONull(body.notas));
    res.json({ ok: true, id: info.lastInsertRowid });
  });
});

app.delete('/api/documentos-modulo/:id', requiereLogin, (req, res) => {
  const doc = db.prepare('SELECT * FROM documentos_modulo WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
  db.prepare('DELETE FROM documentos_modulo WHERE id = ?').run(doc.id);
  borrarAdjunto(doc.archivo);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));

// Red de seguridad: un error inesperado no debe tumbar el servidor para todos
process.on('uncaughtException', (err) => {
  console.error('Error no controlado (el servidor sigue funcionando):', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Promesa rechazada sin controlar:', err);
});

app.listen(PORT, () => {
  console.log(`MAMUTS Flota corriendo en http://localhost:${PORT}`);
});
