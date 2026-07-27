# MAMUTS · Gestión de Flota

Sistema de gestión de vehículos y vales de combustible de **MAMUTS Servicios Especiales**.

## Cómo iniciar la aplicación

Hacé doble clic en **`Iniciar MAMUTS.bat`**. Se abre el navegador solo en
`http://localhost:3000`. Mientras la ventana negra esté abierta, la app funciona;
para apagarla, cerrá esa ventana.

## Credenciales iniciales

- **Usuario:** `admin`
- **Contraseña:** `mamuts2026`

> ⚠️ IMPORTANTE: cambiá la contraseña la primera vez que entres, desde la
> sección **Configuración**.

## Qué hace

- **Vehículos:** alta, edición y baja de los vehículos de la empresa
  (marca, modelo, patente, año, combustible, kilometraje, chofer, observaciones
  y foto opcional). La baja es "lógica": el vehículo deja de aparecer pero su
  historial se conserva.
- **Ficha del vehículo (botón "Ver"):** todos los datos completos, la foto, y una
  base de **datos técnicos y repuestos** (filtros con su código, aceites, batería,
  cubiertas, n° de chasis/motor, etc.) para comprar repuestos o mandar a arreglar.
- **Vales de combustible:** cada vale queda registrado con su vehículo, fecha de
  entrega, litros, número de vale, quién lo recibió y la **foto o escaneo del
  comprobante** (JPG, PNG o PDF, hasta 15 MB). Filtrables por vehículo y fechas.
- **Nómina:** legajo de cada persona que trabaja en la empresa (datos personales,
  puesto, ingreso) con su **documentación adjunta** (licencia, ART, exámenes,
  contrato…). Si un documento tiene vencimiento, el sistema avisa: rojo si venció,
  amarillo si vence en 30 días. La baja conserva el legajo con su fecha.
- **Contactos:** agenda de proveedores, mecánicos, choferes, etc., con nombre,
  empresa, teléfono, país y categoría. Con buscador y filtro por categoría.
- **Seguimiento contable:** registro de gastos con fecha, categoría, monto,
  vehículo y comprobante opcionales. Calcula solo el **total de cada mes**, el
  desglose por categoría y el **total del año**, con la fecha y hora de Argentina
  siempre a la vista.
- **Panel:** resumen del mes (vales, litros y gasto) y vehículos de mayor consumo.
- **Usuarios (solo admin):** creá cuentas para tu equipo y elegí exactamente qué
  puede hacer y ver cada una (11 permisos independientes). Por ejemplo: alguien que
  carga gastos pero no ve los totales, o que sube vehículos pero no ve el consumo.
  También podés resetear la contraseña de cualquier usuario.

## Permisos disponibles por usuario

- **Vehículos:** ver vehículos · agregar/editar/dar de baja · ver el consumo de litros
- **Vales:** registrar vales · ver el listado · ver totales de litros (mes/año)
- **Contactos:** ver · agregar/editar/borrar
- **Seguimiento contable:** registrar gastos · ver el listado · ver totales (mes/año/categoría)

El **administrador** siempre tiene acceso a todo. Los montos se escriben como en
Argentina ("150.000" o "1.250.000,50") y el sistema muestra el valor confirmado
debajo mientras escribís.

## Dónde están los datos

Todo se guarda en la carpeta **`data/`**:

- `data/mamuts.db` → la base de datos (vehículos, vales, usuarios)
- `data/uploads/` → las fotos de los comprobantes

**Copia de seguridad:** copiar la carpeta `data/` completa a un pendrive o a la
nube. Con eso se recupera todo.

## Seguridad

- Nada es visible sin iniciar sesión (ni los datos ni las fotos).
- Las contraseñas se guardan encriptadas (bcrypt).
- Tras 5 intentos fallidos de login, se bloquea por 15 minutos.
- La app envía cabeceras `noindex` y `robots.txt` para no aparecer en buscadores.

## Requisitos técnicos

- Node.js 22 o superior (usa el SQLite integrado de Node, sin compilación nativa).
- Instalar dependencias la primera vez: `npm install`
- Arrancar manualmente: `npm start` (puerto 3000, configurable con la variable `PORT`).
