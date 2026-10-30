# Sistema de Gestión de Torneos de Póker — Arena Maipú

Sistema para administrar los torneos de póker de la sala: alta de jugadores, cobro de Buy-in y Re-Entry, control del día, reportes, cálculo de premios, reloj del torneo para la TV del salón y rotación del personal en mesas.

**Autor:** Brian ([@BrianCeb](https://github.com/BrianCeb))

---

## Índice

1. [Módulos](#módulos)
2. [Tecnologías](#tecnologías)
3. [Estructura del repositorio](#estructura-del-repositorio)
4. [Roles y permisos](#roles-y-permisos)
5. [Reglas de negocio](#reglas-de-negocio)
6. [Reloj del torneo](#reloj-del-torneo)
7. [Modelo de datos](#modelo-de-datos)
8. [API](#api)
9. [Instalación y ejecución](#instalación-y-ejecución)
10. [Variables de entorno](#variables-de-entorno)
11. [Scripts de mantenimiento](#scripts-de-mantenimiento)
12. [Backups](#backups)
13. [Ramas](#ramas)

---

## Módulos

El sistema tiene dos aplicaciones independientes que comparten la misma base de datos (MongoDB Atlas). Cada una tiene su propio servidor Express.

| Módulo | Carpeta | Puerto | Quién lo usa |
|---|---|---|---|
| **Panel Caja** | `panel-caja/` | 4002 | Cajero del torneo |
| **Panel Dirección** | `panel-direccion/` | 4001 | Dirección del torneo |
| **Panel Gerencia** | `panel-direccion/renderer/gerencia.html` | 4001 | Gerencia (solo lectura) |
| **Reloj del torneo** | `panel-direccion/renderer/reloj.html` | 4001 | TV del salón (pública, sin login) |

### Panel Caja
- Inicio de sesión con usuario de rol `caja`.
- Alta, búsqueda y edición de jugadores.
- Cobro de **Buy-in** y **Re-Entry** del torneo activo.
- Impresión del ticket de cada cobro.

### Panel Dirección
Organizado en pestañas:

| Pestaña | Función |
|---|---|
| **Torneo** | Crear el torneo del día: nombre, Buy-in, Re-Entry, rake y tipo (normal o Mistery Bounty). |
| **Control** | Control del día: operaciones, totales y anulaciones. Exporta Excel y CSV. Permite consultar días anteriores. |
| **Registro** | Historial de torneos. |
| **Jugadores** | Listado, alta, edición, historial por jugador y baja de jugadores de prueba. |
| **Estadísticas** | Estadísticas de jugadores. |
| **Reloj** | Configuración y manejo del reloj del torneo (ver [Reloj del torneo](#reloj-del-torneo)). |
| **Rotación** | Tablero de pagadores/croupiers: asignación a mesas, descansos, relevos y cronómetro por estado. |

### Panel Gerencia
Módulo separado, de **solo lectura**, con gráficos y KPIs:
- Composición del recaudado (rake, premios, bounty).
- Jugadores nuevos vs. recurrentes.
- Recaudación y jugadores por torneo.
- Detalle por torneo, con filtro por rango de fechas.

---

## Tecnologías

| Capa | Tecnología |
|---|---|
| Backend | Node.js, Express 4 |
| Base de datos | MongoDB Atlas + Mongoose 8 |
| Autenticación | JWT (`jsonwebtoken`) + contraseñas con hash (`bcryptjs`) |
| Frontend | HTML, CSS y JavaScript sin frameworks |
| Escritorio (desarrollo) | Electron 31 + electron-builder |
| Exportación | ExcelJS (Excel del día) y CSV |
| Tareas programadas | node-cron (backup diario) |

---

## Estructura del repositorio

```
poker-casino-sistema/
├── panel-caja/
│   ├── main.js                  # Ventana Electron + arranque del servidor
│   ├── backend/
│   │   ├── server.js            # Express (puerto 4002)
│   │   ├── config/db.js         # Conexión a MongoDB
│   │   ├── middleware/auth.js   # JWT y control de rol
│   │   ├── models/              # Player, Tournament, Transaction, User
│   │   ├── routes/              # auth, players, tournament, transactions
│   │   ├── scripts/             # usuarios iniciales, borrado de torneo de prueba
│   │   └── utils/diaOperativo.js
│   └── renderer/index.html      # Interfaz de Caja
│
└── panel-direccion/
    ├── main.js
    ├── backend/
    │   ├── server.js            # Express (puerto 4001) + Gerencia + Reloj
    │   ├── config/db.js
    │   ├── data/plantillasIniciales.js   # Estructuras de ciegas precargadas
    │   ├── middleware/
    │   ├── models/              # ver "Modelo de datos"
    │   ├── routes/              # auth, players, tournament, transactions,
    │   │                        # reports, pagadores, reloj
    │   ├── scripts/             # backup, scheduleBackups, usuarios, migraciones
    │   └── utils/               # diaOperativo, mesasConfig, relojCalculos, relojTemas
    └── renderer/
        ├── index.html           # Interfaz de Dirección
        ├── gerencia.html        # Panel Gerencia
        ├── reloj.html           # Pantalla del reloj para la TV
        ├── fuentes/             # Tipografías .woff2 del reloj
        └── reloj-fondo*.jpg     # Fondos por tema del reloj
```

---

## Roles y permisos

Los usuarios se guardan en la colección `users` con contraseña hasheada. Cada petición a la API lleva un token JWT y el backend valida el rol en cada ruta.

| Acción | Caja | Dirección | Gerencia |
|---|:---:|:---:|:---:|
| Alta y edición de jugadores | ✅ | ✅ | — |
| Cobrar Buy-in / Re-Entry | ✅ | — | — |
| Crear torneo | — | ✅ | — |
| Anular operaciones | ❌ | ✅ | — |
| Eliminar jugadores erróneos o de prueba | ❌ | ✅ | — |
| Control del día y exportar Excel/CSV | — | ✅ | — |
| Reloj y rotación de pagadores | — | ✅ | — |
| Reportes y KPIs | — | ✅ | ✅ (solo lectura) |

Al arrancar, el servidor crea los usuarios iniciales definidos en el `.env` si todavía no existen.

---

## Reglas de negocio

- **Sin borrado físico.** Las operaciones anuladas y los jugadores dados de baja quedan en la base con una marca (`anulado` / `activo: false`), y se registra quién anuló y cuándo. Los totales excluyen lo anulado.
- **Un solo Buy-in activo por jugador y por día.** Está garantizado por un índice único parcial en MongoDB. Si el Buy-in se anula, el lugar se libera.
- **Día operativo con corte a las 06:00.** Un torneo que termina después de medianoche sigue perteneciendo al día en que empezó. Esto aplica a historiales, control del día y reportes. Se configura en `utils/diaOperativo.js` (`HORA_CORTE`).
- **"Re-Entry" en la interfaz, `recompra` en el código.** El nombre interno se mantiene por compatibilidad con los datos guardados.
- **Orden de jugadores:** Apellido → Nombre → DNI.
- **Mistery Bounty.** En estos torneos cada cobro guarda su desglose (rake, bounty y prizepool) en el momento del cobro. Así, un cambio posterior en la configuración no altera operaciones pasadas.
- **Premios:**
  - Cobra el **12,5 % de los jugadores reales**, redondeado hacia arriba (un puesto pago más cada 8 jugadores). Jugadores reales = cantidad de Buy-ins; las Re-Entries suman al pozo pero no a la cantidad de pagos.
  - Cada premio se redondea a **$1.000** y la diferencia se ajusta en el 1.er puesto para que el total cierre exacto con el pozo.
  - Se puede usar una tabla personalizada por tramos de jugadores, o plantillas de premios guardadas. Sin tabla, se usa la fórmula automática, que no tiene tope de jugadores.
- **Jugadores restantes** = Buy-ins − eliminaciones. Una eliminación se registra solo cuando el jugador se va sin hacer Re-Entry.
- **Excel del día.** Es el informe que se envía a fiscalización. Usa los mismos cálculos de premios que la pantalla del reloj.

---

## Reloj del torneo

Pantalla para la TV del salón (`/reloj.html`). Es pública y de solo lectura, y se maneja desde la pestaña **Reloj** de Dirección.

- **Muestra:** nombre del torneo, nivel actual, ciegas y ante, tiempo restante, próximo descanso, entradas, Re-Entries, jugadores restantes, stack promedio, pozo, tabla de premios y cierre del registro.
- **Estructuras de ciegas.** Se guardan como plantillas reutilizables (por ejemplo, *Funny Sundays*). Al aplicarlas se **copian** al torneo, así que editar una no afecta a la otra.
- **Tiempo sincronizado.** No se descuenta en el navegador. Se guarda cuándo arrancó el nivel y cuántos segundos ya se consumieron, y cada pantalla calcula el resto. Por eso todas muestran lo mismo aunque se recarguen o se abran en otra PC.
- **Controles:** iniciar, pausar, reanudar, avanzar o retroceder nivel, y finalizar.
- **Modo prueba.** Es una copia aislada del reloj (colección `relojpruebas`) para probar estructuras, premios y sonidos con jugadores ficticios. No genera transacciones ni afecta reportes. Los cambios pasan al torneo real solo con "Aplicar al torneo real".
- **Temas visuales** seleccionables (por ejemplo, Clásico y Crema), cada uno con su tipografía y fondo.

La lógica de cálculo está en `backend/utils/relojCalculos.js`.

---

## Modelo de datos

Colecciones de MongoDB (modelos Mongoose):

| Modelo | Descripción |
|---|---|
| `Player` | Jugador: DNI (único), nombre, apellido, teléfono, email, `activo`. |
| `Tournament` | Torneo del día: Buy-in, Re-Entry, rake, tipo, montos de Mistery Bounty, fecha operativa, `activo`. |
| `Transaction` | Cobro de Buy-in o Re-Entry: jugador, monto, torneo, fecha, hora, cajero, desglose, datos de anulación. |
| `User` | Usuario del sistema: username, hash de contraseña, rol. |
| `RelojTorneo` | Configuración y estado del reloj de un torneo: niveles, stacks, Re-Entries, premios, eliminaciones, estado. |
| `RelojPrueba` | Copia del reloj para el modo prueba (mismo esquema). |
| `EstructuraCiegas` | Plantillas de estructura de ciegas. |
| `PlantillaPremios` | Plantillas de tablas de premios. |
| `Pagador` | Pagador/croupier: estado (disponible, en mesa, en descanso) y mesa. |
| `TurnoPagador` | Historial de bloques de trabajo y descanso de cada pagador. |
| `Config` | Ajustes clave/valor (cantidad de mesas, tema del reloj). |

---

## API

Todas las rutas van bajo `/api` y requieren `Authorization: Bearer <token>`, salvo `/auth/login` y `/reloj/pantalla`.

**Panel Caja (4002)**

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/login` | Inicio de sesión |
| GET | `/players`, `/players/:dni` | Listado y búsqueda de jugadores |
| POST / PUT | `/players`, `/players/:id` | Alta y edición de jugador |
| GET | `/tournament` | Torneo activo |
| POST | `/transactions` | Registrar Buy-in o Re-Entry |

**Panel Dirección (4001)**

| Grupo | Rutas principales |
|---|---|
| Jugadores | `GET/POST /players`, `PUT/DELETE /players/:id`, `/players/:id/historial`, `/players/estadisticas` |
| Torneo | `GET/POST /tournament`, `/tournament/historial` |
| Operaciones | `/transactions/today`, `PATCH /transactions/:id/anular`, `/transactions/export.xlsx`, `/transactions/export.csv` |
| Reportes | `/reports/resumen` (Dirección y Gerencia) |
| Rotación | `/pagadores`, `/pagadores/tablero`, `/pagadores/cantidad-mesas`, asignar/mover mesa, descanso, relevo |
| Reloj | `/reloj`, `/reloj/pantalla` (pública), `/reloj/accion`, `/reloj/config`, `/reloj/niveles`, `/reloj/tema`, plantillas de ciegas y de premios, `/reloj/prueba` |

Además, el servidor de Dirección sirve `/gerencia.html`, `/reloj.html`, las tipografías del reloj y sus imágenes de fondo.

---

## Instalación y ejecución

**Requisitos:** Node.js 18 o superior y un cluster de MongoDB Atlas.

```bash
# Panel Dirección
cd panel-direccion
npm install
cp .env.example .env     # completar con los datos reales
npm start                # abre la app en Electron

# Panel Caja (en otra terminal)
cd panel-caja
npm install
cp .env.example .env
npm start
```

Con Dirección corriendo:
- Gerencia: `http://127.0.0.1:4001/gerencia.html`
- Reloj: `http://127.0.0.1:4001/reloj.html`

Para generar un instalador de Windows: `npm run dist` (dentro de cada panel).

> Electron se usa para desarrollo. En producción, Caja se usa como aplicación web desde una tablet, y la configuración del servidor de producción se gestiona aparte.

---

## Variables de entorno

Cada panel tiene su propio `.env`, que **nunca se sube al repositorio**. Ver los `.env.example`.

| Variable | Uso |
|---|---|
| `MONGODB_URI` | Cadena de conexión a MongoDB Atlas (la misma en ambos paneles) |
| `PORT` | 4001 (Dirección) / 4002 (Caja) |
| `JWT_SECRET` | Clave para firmar los tokens (**la misma en ambos paneles**) |
| `DIRECCION_USER` / `DIRECCION_PASSWORD` | Usuario inicial de Dirección |
| `CAJA_USER` / `CAJA_PASSWORD` | Usuario inicial de Caja |
| `GERENCIA_USER` / `GERENCIA_PASSWORD` | Usuario inicial de Gerencia (opcional) |
| `BACKUP_DIR` | Carpeta de backups (solo Dirección; por defecto `./backups`) |

---

## Scripts de mantenimiento

| Script | Panel | Qué hace |
|---|---|---|
| `npm run backup` | Dirección | Backup manual a JSON. |
| `scripts/ensureDefaultUsers.js` | Ambos | Crea los usuarios iniciales. Se ejecuta solo al arrancar. |
| `scripts/borrar-torneo-prueba.js` | Caja | Borra un torneo de prueba y sus transacciones, sin tocar jugadores. Funciona en dos pasos: simulación y confirmación. |
| `scripts/fixTorneo0609.js` | Dirección | Migración puntual: crea un torneo faltante del 06/09 para Gerencia. |

---

## Backups

- **Automático:** todos los días a las 05:00 (`node-cron`). Exporta jugadores, torneos y transacciones a JSON dentro de `BACKUP_DIR`.
- **Manual:** `npm run backup` desde `panel-direccion/`.
- Es una red de seguridad **adicional** a los backups de MongoDB Atlas. Conviene copiar la carpeta a otro lugar (disco externo o nube).

---

## Ramas

| Rama | Contenido |
|---|---|
| `main` | Versión estable, igual a producción |
| `actualizacion5` | Rama desplegada en producción |
| `feature/reloj` | Mejoras del reloj en desarrollo (nuevos temas y fondos) |
| `actualizacion` … `actualizacion4`, `funcionalidades`, `fix/actualizacion3` | Versiones anteriores, ya integradas en `main` |
