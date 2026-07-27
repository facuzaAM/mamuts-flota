const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
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
asegurarColumna('usuarios', 'permisos', 'permisos TEXT');
asegurarColumna('usuarios', 'nombre', 'nombre TEXT');
asegurarColumna('vales', 'tipo_combustible', 'tipo_combustible TEXT');
asegurarColumna('vales', 'grado', 'grado TEXT');
asegurarColumna('vales', 'monto', 'monto REAL');

// Usuario administrador inicial (cambiar la contraseña desde Configuración)
const adminExiste = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n > 0;
if (!adminExiste) {
  const hash = bcrypt.hashSync('mamuts2026', 10);
  db.prepare('INSERT INTO usuarios (username, password_hash, rol) VALUES (?, ?, ?)')
    .run('admin', hash, 'admin');
  console.log('Usuario inicial creado -> usuario: admin / contraseña: mamuts2026');
}

module.exports = db;
