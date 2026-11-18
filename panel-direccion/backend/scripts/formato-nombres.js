/**
 * FORMATO DE NOMBRES - Panel Dirección (Arena Poker)
 * ==================================================
 *
 * Se corre UNA sola vez, para los registros que ya estaban cargados en
 * minúscula, en mayúscula o mezclados. Deja la inicial de cada palabra
 * en mayúscula y el resto en minúscula: "juan CARLOS" -> "Juan Carlos".
 * Desde esta versión el sistema ya guarda solo los nombres nuevos con
 * este formato (modelo Player y Pago).
 *
 * QUÉ CAMBIA (solo el texto de nombre y apellido, nada más):
 *   - players:      nombre y apellido
 *   - transactions: nombre y apellido (copia que se guarda en cada cobro)
 *   - pagos:        nombre (premios, bounties y Hunter)
 *   Además quita espacios de más: "juan   perez " -> "Juan Perez".
 *
 * QUÉ NO TOCA: DNI, montos, fechas, torneos ni ningún otro dato.
 *
 * CÓMO SE USA (en dos pasos, por seguridad), desde panel-direccion/:
 *
 *   1) Modo prueba (no cambia nada, muestra qué cambiaría):
 *        node backend/scripts/formato-nombres.js
 *
 *   2) Si está bien, aplicar de verdad:
 *        node backend/scripts/formato-nombres.js --confirmar
 *      Pide escribir CONFIRMAR. Antes de cambiar nada guarda un respaldo
 *      con los valores viejos en BACKUP_DIR/formato-nombres-<fecha>.json.
 *
 * Usa el .env de la raíz de panel-direccion/ (el mismo de la app).
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mongoose = require('mongoose');

const confirmar = process.argv.includes('--confirmar');

// Misma regla que models/Player.js.
const formatoNombre = v => String(v == null ? '' : v)
  .replace(/\s+/g, ' ').trim()
  .toLocaleLowerCase('es-AR')
  .replace(/(^|[\s\-'])(\p{L})/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase('es-AR'));

// Colección -> campos a pasar a mayúscula.
const COLECCIONES = {
  players: ['nombre', 'apellido'],
  transactions: ['nombre', 'apellido'],
  pagos: ['nombre']
};

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(texto, r => { rl.close(); resolve(r); }));
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('❌ No se encontró MONGODB_URI. Corré el script desde la carpeta panel-direccion/.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log('✅ Conectado a MongoDB.\n');

  // 1) Buscar qué hay que cambiar
  const cambios = {};
  for (const [col, campos] of Object.entries(COLECCIONES)) {
    const proyeccion = Object.fromEntries(campos.map(c => [c, 1]));
    const docs = await db.collection(col).find({}, { projection: proyeccion }).toArray();
    cambios[col] = docs
      .map(d => {
        const nuevo = {};
        const viejo = {};
        for (const c of campos) {
          if (typeof d[c] !== 'string') continue;
          const m = formatoNombre(d[c]);
          if (m !== d[c]) { nuevo[c] = m; viejo[c] = d[c]; }
        }
        return Object.keys(nuevo).length ? { _id: d._id, viejo, nuevo } : null;
      })
      .filter(Boolean);
    console.log(`${col.padEnd(13)} ${String(docs.length).padStart(6)} registros · ${String(cambios[col].length).padStart(6)} a cambiar`);
  }

  console.log('\nEjemplos (jugadores):');
  cambios.players.slice(0, 15).forEach(c =>
    console.log(`  ${JSON.stringify(c.viejo)}  ->  ${JSON.stringify(c.nuevo)}`)
  );
  if (!cambios.players.length) console.log('  (ninguno)');

  const total = Object.values(cambios).reduce((s, l) => s + l.length, 0);
  if (!total) {
    console.log('\n✅ No hay nada para cambiar: todos los nombres ya tienen el formato correcto.');
    return mongoose.disconnect();
  }

  if (!confirmar) {
    console.log(`\n🔎 Modo prueba: no se cambió nada. Para aplicar los ${total} cambios, corré de nuevo con --confirmar`);
    return mongoose.disconnect();
  }

  const respuesta = await preguntar(`\n⚠️  Se van a modificar ${total} registros en la base REAL. Escribí CONFIRMAR para seguir: `);
  if (respuesta.trim() !== 'CONFIRMAR') {
    console.log('Cancelado. No se cambió nada.');
    return mongoose.disconnect();
  }

  // 2) Respaldo con los valores viejos (si falla, no se cambia nada)
  const dir = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `formato-nombres-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(archivo, JSON.stringify(cambios, null, 2));
  console.log(`💾 Respaldo de los valores viejos: ${archivo}`);

  // 3) Aplicar
  for (const [col, lista] of Object.entries(cambios)) {
    if (!lista.length) continue;
    for (let i = 0; i < lista.length; i += 500) {
      const lote = lista.slice(i, i + 500).map(c => ({
        updateOne: { filter: { _id: c._id }, update: { $set: c.nuevo } }
      }));
      await db.collection(col).bulkWrite(lote, { ordered: false });
    }
    console.log(`✅ ${col}: ${lista.length} actualizados`);
  }

  console.log('\nListo.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
