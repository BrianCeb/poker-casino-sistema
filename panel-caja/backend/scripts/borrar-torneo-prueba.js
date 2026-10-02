/**
 * BORRAR TORNEO DE PRUEBA - Panel Caja (Arena Poker)
 * ====================================================
 *
 * Pensado para borrar, de forma controlada, un torneo de prueba (y las
 * transacciones de Buy-in/Re-Entry que se hayan generado probando la
 * impresora) sin tocar el resto de los datos reales del casino.
 *
 * QUÉ BORRA:
 *   - El documento del torneo en la colección "tournaments".
 *   - Las transacciones (colección "transactions") que apunten a ese
 *     torneo, ya sea por torneoId (lo normal) o, como respaldo, por el
 *     nombre exacto guardado en el campo "torneo".
 *
 * QUÉ **NO** TOCA NUNCA:
 *   - La colección "players" (los jugadores registrados). Aunque el
 *     torneo de prueba se haya hecho con un jugador real para probar,
 *     ese jugador y su ficha NO se tocan.
 *   - Cualquier otro torneo o transacción que no coincida con el que
 *     se pide borrar.
 *
 * CÓMO SE USA (en dos pasos, por seguridad):
 *
 *   1) MODO DE PRUEBA (no borra nada, solo muestra qué encontraría):
 *        node borrar-torneo-prueba.js "Nombre exacto del torneo"
 *
 *      También podés buscarlo por id de Mongo si lo tenés:
 *        node borrar-torneo-prueba.js --id 651f3a...
 *
 *   2) Si la lista de arriba es exactamente lo que esperás borrar,
 *      confirmás el borrado real agregando --confirmar:
 *        node borrar-torneo-prueba.js "Nombre exacto del torneo" --confirmar
 *
 *      Te va a pedir además que escribas BORRAR a mano en la consola,
 *      como última confirmación, antes de tocar la base de datos real.
 *
 * REQUISITOS:
 *   - Va DENTRO de panel-caja/backend/scripts/ (ahí es donde tiene que
 *     quedar el archivo). Los modelos (Tournament, Transaction) están un
 *     nivel arriba, en panel-caja/backend/. El .env está DOS niveles
 *     arriba, en la raíz de panel-caja/ (el mismo que carga main.js con
 *     Electron), no dentro de backend/.
 */

const path = require('path');
const readline = require('readline');

// El .env vive en la raíz de panel-caja/ (dos niveles arriba de
// backend/scripts/), el mismo que usa main.js. NO está en backend/.
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ No se encontró MONGODB_URI. Corré este script desde panel-caja/backend/scripts/.');
  process.exit(1);
}

// Usamos los mismos modelos que el proyecto para no reinventar los
// schemas (así respetamos exactamente los mismos campos e índices).
// Están un nivel arriba porque este script vive en backend/scripts/.
const Tournament = require('../models/Tournament');
const Transaction = require('../models/Transaction');

/* =========================================
   LECTURA DE ARGUMENTOS
========================================= */

const args = process.argv.slice(2);
const confirmar = args.includes('--confirmar');
const idIndex = args.indexOf('--id');

let filtro = null;
let modoBusqueda = null;

if (idIndex !== -1 && args[idIndex + 1]) {
  filtro = args[idIndex + 1];
  modoBusqueda = 'id';
} else {
  // El primer argumento que no sea --confirmar es el nombre del torneo.
  const nombre = args.find(a => a !== '--confirmar' && a !== '--id');
  if (nombre) {
    filtro = nombre;
    modoBusqueda = 'nombre';
  }
}

if (!filtro) {
  console.error('Uso:');
  console.error('  node borrar-torneo-prueba.js "Nombre exacto del torneo"           (modo prueba)');
  console.error('  node borrar-torneo-prueba.js "Nombre exacto del torneo" --confirmar (borra de verdad)');
  console.error('  node borrar-torneo-prueba.js --id <idDelTorneo> [--confirmar]');
  process.exit(1);
}

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(texto, respuesta => {
      rl.close();
      resolve(respuesta);
    });
  });
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Conectado a MongoDB.\n');

  const torneo = modoBusqueda === 'id'
    ? await Tournament.findById(filtro)
    : await Tournament.findOne({ nombre: filtro });

  if (!torneo) {
    console.error(`❌ No se encontró ningún torneo ${modoBusqueda === 'id' ? `con id "${filtro}"` : `con el nombre exacto "${filtro}"`}.`);

    if (modoBusqueda === 'nombre') {
      const parecidos = await Tournament.find({
        nombre: { $regex: filtro, $options: 'i' }
      }).select('nombre fecha activo').limit(10);

      if (parecidos.length) {
        console.log('\nTorneos con nombre parecido que sí existen:');
        parecidos.forEach(t => console.log(`  - "${t.nombre}" (fecha: ${t.fecha}, activo: ${t.activo}, id: ${t._id})`));
      } else {
        const ultimos = await Tournament.find().sort({ createdAt: -1 }).select('nombre fecha activo').limit(10);
        console.log('\nÚltimos torneos existentes en la base:');
        ultimos.forEach(t => console.log(`  - "${t.nombre}" (fecha: ${t.fecha}, activo: ${t.activo}, id: ${t._id})`));
      }
    }

    await mongoose.disconnect();
    process.exit(1);
  }

  // Transacciones que apuntan a este torneo: por torneoId (lo normal) o,
  // como respaldo, por el nombre guardado en el campo "torneo" (por si
  // alguna transacción vieja quedó sin torneoId).
  const transacciones = await Transaction.find({
    $or: [
      { torneoId: torneo._id },
      { torneo: torneo.nombre }
    ]
  });

  console.log('=========================================');
  console.log(' TORNEO ENCONTRADO');
  console.log('=========================================');
  console.log(`Nombre:   ${torneo.nombre}`);
  console.log(`Id:       ${torneo._id}`);
  console.log(`Buy-in:   ${torneo.buyIn}`);
  console.log(`Recompra: ${torneo.recompra}`);
  console.log(`Fecha:    ${torneo.fecha}`);
  console.log(`Activo:   ${torneo.activo}`);

  console.log('\n=========================================');
  console.log(` TRANSACCIONES QUE SE VAN A BORRAR (${transacciones.length})`);
  console.log('=========================================');

  if (!transacciones.length) {
    console.log('(ninguna)');
  } else {
    const porTipo = transacciones.reduce((acc, t) => {
      acc[t.tipo] = (acc[t.tipo] || 0) + 1;
      return acc;
    }, {});
    const total = transacciones.reduce((acc, t) => acc + Number(t.monto || 0), 0);
    const dnis = [...new Set(transacciones.map(t => t.dni))];

    transacciones.forEach(t => {
      console.log(`  - ${t.fecha} ${t.hora}  ${t.tipo.padEnd(9)}  DNI ${t.dni}  ${t.nombre} ${t.apellido}  $${t.monto}${t.anulado ? '  (ANULADA)' : ''}`);
    });

    console.log(`\nResumen: ${JSON.stringify(porTipo)} — total $${total} — DNIs involucrados: ${dnis.join(', ')}`);
  }

  console.log('\nRecordá: esto NO borra ni modifica jugadores (colección "players"), sin importar cuántas transacciones tengan.');

  if (!confirmar) {
    console.log('\n🔎 Modo de prueba (dry-run): no se borró nada todavía.');
    console.log('   Si esta lista es exactamente lo que querés borrar, volvé a correr el script agregando --confirmar al final.');
    await mongoose.disconnect();
    return;
  }

  console.log('\n⚠️  Vas a borrar el torneo de arriba y sus transacciones de la base de datos REAL. Esto no se puede deshacer.');
  const respuesta = await preguntar('Escribí BORRAR (en mayúsculas) para confirmar, o cualquier otra cosa para cancelar: ');

  if (respuesta.trim() !== 'BORRAR') {
    console.log('\nCancelado. No se borró nada.');
    await mongoose.disconnect();
    return;
  }

  const resultadoTx = await Transaction.deleteMany({
    $or: [
      { torneoId: torneo._id },
      { torneo: torneo.nombre }
    ]
  });
  const resultadoTorneo = await Tournament.deleteOne({ _id: torneo._id });

  console.log(`\n✅ Transacciones borradas: ${resultadoTx.deletedCount}`);
  console.log(`✅ Torneo borrado: ${resultadoTorneo.deletedCount === 1 ? 'sí' : 'no'}`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});