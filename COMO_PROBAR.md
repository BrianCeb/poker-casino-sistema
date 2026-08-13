# Paso a paso para probar el sistema en tu PC

Tenés dos carpetas independientes: `panel-direccion` y `panel-caja`.
Cada una es una app de escritorio completa (Electron) con su propio
mini-servidor adentro. Las dos se conectan a la MISMA base de datos en
MongoDB Atlas, así que lo que registrás en una aparece al instante en
la otra.

Para probar en tu propia PC podés abrir las dos carpetas al mismo
tiempo (son procesos separados, no hay conflicto).

---

## 0) Lo que necesitás instalar una sola vez

1. **Node.js** (versión 18 o superior): [https://nodejs.org](https://nodejs.org) → descargar el instalador LTS y correrlo. Se instala Node y npm juntos.
2. **Visual Studio Code**: [https://code.visualstudio.com](https://code.visualstudio.com)
3. **Una cuenta de MongoDB Atlas** (gratis para probar): [https://www.mongodb.com/cloud/atlas/register](https://www.mongodb.com/cloud/atlas/register)

Para confirmar que Node quedó bien instalado, abrí una terminal (en Windows: buscá "cmd" o "PowerShell") y escribí:

```bash
node -v
npm -v
```

Si te devuelve números de versión, está listo.

---

## 1) Crear la base de datos en Atlas (una sola vez)

1. Entrá a Atlas y creá un proyecto nuevo (cualquier nombre, ej. "Poker Casino").
2. Creá un cluster **gratis (M0)** para esta primera prueba — más adelante, antes de ir a producción con dinero real, pasás a un plan con backups (te lo expliqué en la respuesta anterior).
3. En **Database Access**, creá un usuario de base de datos (usuario + contraseña, anotalos).
4. En **Network Access**, agregá tu IP actual (Atlas te lo sugiere con un botón "Add current IP address"). Para probar en tu casa alcanza con eso.
5. En **Database > Connect > Drivers**, elegí Node.js y copiá la cadena de conexión. Se ve así:
   ```
   mongodb+srv://usuario:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   Reemplazá `<password>` por la contraseña real, y agregale el nombre de la base al final, antes del `?`:
   ```
   mongodb+srv://usuario:tupassword@cluster0.xxxxx.mongodb.net/poker_casino?retryWrites=true&w=majority
   ```

Guardá esa cadena, la vas a pegar en dos archivos `.env`.

---

## 2) Abrir el proyecto en VS Code

1. Abrí VS Code.
2. `Archivo > Abrir carpeta` → elegí la carpeta `poker-desktop` (la que contiene `panel-direccion` y `panel-caja`).
3. Abrí una terminal integrada: menú `Terminal > Nueva Terminal` (o `Ctrl + ñ` / `` Ctrl+` ``).

---

## 3) Configurar y probar el Panel Dirección

En la terminal de VS Code:

```bash
cd panel-direccion
copy .env.example .env
```
(en Mac/Linux sería `cp .env.example .env`)

Abrí el archivo `.env` que se generó (aparece en el explorador de archivos de VS Code) y completá:
- `MONGODB_URI` con la cadena que copiaste de Atlas.
- `DIRECCION_API_KEY` con cualquier clave que inventes, por ejemplo `casino2026clave`.

**Importante:** esa misma clave la tenés que escribir también en
`panel-direccion/renderer/index.html`, en esta línea cerca del final del `<script>`:
```js
const DIRECCION_KEY = 'cambiar-esta-clave';
```
Reemplazá `'cambiar-esta-clave'` por la clave que pusiste en el `.env` (tienen que ser idénticas).

Ahora instalá las dependencias y arrancá la app:

```bash
npm install
npm start
```

La primera vez `npm install` tarda unos minutos (descarga Electron). Cuando termine, `npm start` te va a abrir una ventana de escritorio con el Panel Dirección. Arriba a la derecha deberías ver un puntito verde y "Conectado a la base de datos" — si sale rojo, revisá la cadena de conexión o el "Network Access" de Atlas.

Probá dar de alta un jugador de prueba.

---

## 4) Configurar y probar el Panel Caja

Abrí **otra** terminal en VS Code (no cierres la anterior, dejá el Panel Dirección abierto) y repetí el proceso en la otra carpeta:

```bash
cd panel-caja
copy .env.example .env
```

Completá `.env` con la **misma** `MONGODB_URI` que usaste en Dirección (mismo cluster, misma base). Este `.env` no necesita `DIRECCION_API_KEY` porque Caja no la usa.

```bash
npm install
npm start
```

Se abre la ventana de Caja. Buscá el DNI del jugador que diste de alta en el paso anterior — tiene que aparecerlo y ofrecerte el botón de **Buy-in**. Registralo, y si volvés a buscar el mismo DNI ahora te va a ofrecer **Recompra**. Esa es la prueba de que las dos apps están compartiendo la misma base en tiempo real.

---

## 5) Cuando ya probaste que funciona: generar el instalador (.exe)

Esto se hace en cada carpeta por separado, cuando quieras instalar la app "de verdad" en las PCs del casino (no hace falta para seguir probando):

```bash
npm run dist
```

Te va a generar una carpeta `dist/` con un instalador `.exe`. Ese es el archivo que copiás a la PC de destino y ejecutás — instala la app con su ícono, sin necesidad de VS Code ni de Node instalado en esa PC.

---

## Problemas comunes

- **"Sin conexión" en rojo:** casi siempre es el Network Access de Atlas (tu IP no está permitida) o un typo en `MONGODB_URI`.
- **`npm install` tira error:** confirmá que `node -v` te devuelve 18 o más. Si es más vieja, reinstalá Node desde nodejs.org.
- **Dirección no puede editar el torneo / no puede registrar jugadores:** revisá que `DIRECCION_API_KEY` del `.env` sea idéntica a `DIRECCION_KEY` del `index.html`.
- **Caja no encuentra un jugador que sabés que existe:** confirmá que las dos apps tengan la MISMA `MONGODB_URI` (mismo cluster y mismo nombre de base al final de la URL).
