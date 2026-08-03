const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'mamuts.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'admin' CHECK (rol IN ('admin', 'operador')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS vehiculos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marca TEXT NOT NULL,
  modelo TEXT NOT NULL,
  patente TEXT NOT NULL UNIQUE COLLATE NOCASE,
  anio INTEGER,
  tipo_combustible TEXT NOT NULL DEFAULT 'Diesel',
  kilometraje INTEGER,
  chofer TEXT,
  notas TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS vales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id),
  fecha TEXT NOT NULL,
  litros REAL NOT NULL CHECK (litros > 0),
  numero_vale TEXT,
  receptor TEXT,
  observaciones TEXT,
  foto_archivo TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS datos_tecnicos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id),
  tipo TEXT NOT NULL,
  codigo TEXT,
  marca TEXT,
  notas TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS contactos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  empresa TEXT,
  telefono TEXT,
  pais TEXT,
  categoria TEXT,
  notas TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS gastos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  categoria TEXT NOT NULL,
  descripcion TEXT,
  monto REAL NOT NULL CHECK (monto > 0),
  vehiculo_id INTEGER REFERENCES vehiculos(id),
  comprobante_archivo TEXT,
  creado_por TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS empleados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  dni_cuil TEXT,
  fecha_nacimiento TEXT,
  telefono TEXT,
  direccion TEXT,
  contacto_emergencia TEXT,
  puesto TEXT,
  fecha_ingreso TEXT,
  notas TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  fecha_baja TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS documentos_empleado (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empleado_id INTEGER NOT NULL REFERENCES empleados(id),
  tipo TEXT NOT NULL,
  vencimiento TEXT,
  archivo TEXT,
  notas TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ===== Operaciones · Módulos habitacionales =====

CREATE TABLE IF NOT EXISTS modulos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bien_capital TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tipo TEXT,
  largo REAL,
  ancho REAL,
  alto REAL,
  cliente TEXT,
  ubicacion TEXT,
  estado TEXT NOT NULL DEFAULT 'Pendiente',
  avance INTEGER NOT NULL DEFAULT 0 CHECK (avance BETWEEN 0 AND 100),
  fecha_objetivo TEXT,
  notas TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS modulo_fotos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modulo_id INTEGER NOT NULL REFERENCES modulos(id),
  archivo TEXT NOT NULL,
  descripcion TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Parte de trabajo: qué se hizo en un módulo un día determinado
CREATE TABLE IF NOT EXISTS partes_diarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  modulo_id INTEGER NOT NULL REFERENCES modulos(id),
  actividades TEXT NOT NULL,
  responsable TEXT,
  avance INTEGER CHECK (avance BETWEEN 0 AND 100),
  notas TEXT,
  creado_por TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS parte_fotos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parte_id INTEGER NOT NULL REFERENCES partes_diarios(id),
  archivo TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS materiales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modulo_id INTEGER REFERENCES modulos(id),
  fecha TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  cantidad REAL,
  unidad TEXT,
  estado TEXT NOT NULL DEFAULT 'Pedido',
  proveedor TEXT,
  costo REAL,
  notas TEXT,
  comprobante_archivo TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS documentos_modulo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modulo_id INTEGER REFERENCES modulos(id),
  tipo TEXT NOT NULL,
  titulo TEXT,
  archivo TEXT,
  notas TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Reporte diario de operaciones: solo la fecha y el PDF; el detalle va adentro del archivo
CREATE TABLE IF NOT EXISTS reportes_diarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  archivo TEXT NOT NULL,
  creado_por TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ===== Pañol: stock de materiales del depósito =====
-- Tablas propias (panol_*) para no mezclarse con los materiales de Operaciones
CREATE TABLE IF NOT EXISTS panol_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  cantidad REAL NOT NULL DEFAULT 0,
  unidad TEXT,
  minimo REAL,
  ubicacion TEXT,
  fecha_ingreso TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS panol_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES panol_items(id),
  fecha TEXT NOT NULL,
  delta REAL NOT NULL,
  cantidad_final REAL NOT NULL,
  motivo TEXT,
  usuario TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Bitácora general del sistema (sección Actualizaciones)
CREATE TABLE IF NOT EXISTS actividad (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  usuario TEXT,
  area TEXT NOT NULL,
  accion TEXT NOT NULL,
  detalle TEXT,
  entidad_id INTEGER,
  permiso TEXT
);

CREATE INDEX IF NOT EXISTS idx_panol_mov ON panol_movimientos(item_id);
CREATE INDEX IF NOT EXISTS idx_actividad_id ON actividad(id DESC);
CREATE INDEX IF NOT EXISTS idx_reportes_fecha ON reportes_diarios(fecha);
CREATE INDEX IF NOT EXISTS idx_modulo_fotos ON modulo_fotos(modulo_id);
CREATE INDEX IF NOT EXISTS idx_partes_fecha ON partes_diarios(fecha);
CREATE INDEX IF NOT EXISTS idx_partes_modulo ON partes_diarios(modulo_id);
CREATE INDEX IF NOT EXISTS idx_parte_fotos ON parte_fotos(parte_id);
CREATE INDEX IF NOT EXISTS idx_materiales_modulo ON materiales(modulo_id);
CREATE INDEX IF NOT EXISTS idx_docs_modulo ON documentos_modulo(modulo_id);

CREATE INDEX IF NOT EXISTS idx_docs_empleado ON documentos_empleado(empleado_id);
CREATE INDEX IF NOT EXISTS idx_vales_vehiculo ON vales(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_vales_fecha ON vales(fecha);
CREATE INDEX IF NOT EXISTS idx_tecnicos_vehiculo ON datos_tecnicos(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos(fecha);
`);

// Migraciones simples: columnas nuevas sobre bases existentes
function asegurarColumna(tabla, columna, ddl) {
  const existe = db.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === columna);
  if (!existe) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${ddl}`);
}
asegurarColumna('vehiculos', 'foto_archivo', 'foto_archivo TEXT');
// Los vehículos ya cargados quedan como 'Propio', que es el caso más común
asegurarColumna('vehiculos', 'propiedad', "propiedad TEXT NOT NULL DEFAULT 'Propio'");
// La baja de materiales es lógica: deja de aparecer pero se conserva el registro
asegurarColumna('materiales', 'activo', 'activo INTEGER NOT NULL DEFAULT 1');
// El destino pasó a ser texto libre; los que apuntaban a un módulo conservan su nombre
asegurarColumna('materiales', 'destino', 'destino TEXT');
db.exec(`
  UPDATE materiales SET destino = (SELECT bien_capital FROM modulos WHERE modulos.id = materiales.modulo_id)
  WHERE destino IS NULL AND modulo_id IS NOT NULL
`);
// Los estados viejos pasan a los dos que se usan hoy: Pedido y Comprado
db.exec("UPDATE materiales SET estado = 'Comprado' WHERE estado IN ('Recibido', 'Consumido')");
db.exec("UPDATE materiales SET estado = 'Pedido' WHERE estado = 'Pendiente'");
asegurarColumna('usuarios', 'permisos', 'permisos TEXT');
asegurarColumna('usuarios', 'nombre', 'nombre TEXT');
asegurarColumna('vales', 'tipo_combustible', 'tipo_combustible TEXT');
asegurarColumna('vales', 'grado', 'grado TEXT');
asegurarColumna('vales', 'monto', 'monto REAL');

// Usuario administrador inicial. La contraseña se genera al azar en el primer
// arranque y se muestra una sola vez: no puede quedar escrita en el código
// porque el repositorio es público.
const adminExiste = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n > 0;
if (!adminExiste) {
  const passwordInicial = crypto.randomBytes(12).toString('base64url');
  db.prepare('INSERT INTO usuarios (username, password_hash, rol) VALUES (?, ?, ?)')
    .run('admin', bcrypt.hashSync(passwordInicial, 10), 'admin');
  console.log('\n' + '='.repeat(58));
  console.log('  Usuario inicial creado');
  console.log('  usuario:     admin');
  console.log(`  contraseña:  ${passwordInicial}`);
  console.log('  Anotala ahora: no se vuelve a mostrar.');
  console.log('  Cambiala desde Configuración al entrar.');
  console.log('='.repeat(58) + '\n');
}

module.exports = db;
