/**
 * CARGAR PREMIOS DE TORNEOS ANTERIORES - Panel Dirección (Arena Poker)
 * =====================================================================
 *
 * Lee un bloc de notas (.txt) con los ganadores de torneos viejos y los
 * carga como pagos de premio (los mismos que hoy registra Caja), para
 * que aparezcan en Estadísticas y en los totales de pagos.
 *
 * FORMATO DEL .txt (el que ya usás):
 *
 *   Premios Funny Sundays
 *   30 / 08 :
 *       1 : Facundo de La Reta $ 943.500
 *       2 : Leo Fernandez : $ 637.500
 *       5 : Muñoz Alfredo : $ 280.500
 *       6 : $ 200.000                        <- sin nombre: se saltea
 *       7 : Juan Perez : $ 150.000 DNI 30111222  <- DNI opcional
 *
 *   - "Premios <nombre>" indica el torneo de las fechas que siguen.
 *   - La fecha va como dd/mm (o dd/mm/aaaa). Sin año se toma el año
 *     actual, o el anterior si esa fecha todavía no pasó.
 *   - El nombre puede ir en cualquier orden (Nombre Apellido o al revés).
 *
 * CÓMO ENCUENTRA A CADA UNO:
 *   - El torneo: por fecha (y por nombre si ese día hubo más de uno).
 *   - El ganador: entre los inscriptos (Buy-in) de ese torneo. Si lo
 *     encuentra queda con su DNI y suma en Estadísticas. Si no lo
 *     encuentra o hay más de uno parecido, NO lo carga y te lo muestra:
 *     agregale "DNI xxxxxxxx" a esa línea y volvé a correrlo.
 *
 * CÓMO SE USA (desde la carpeta panel-direccion/):
 *
 *   1) Modo prueba (no carga nada, muestra qué cargaría):
 *        node backend/scripts/premios-historicos.js premios.txt
 *
 *   2) Si está bien:
 *        node backend/scripts/premios-historicos.js premios.txt --confirmar
 *      (pide escribir CONFIRMAR)
 *
 * Se puede correr las veces que haga falta con el mismo archivo: los
 * puestos que ya están cargados (o que ya pagó Caja) se saltean.
 * Los pagos cargados así quedan con cajero "Carga histórica"; si alguno
 * quedó mal, se anula desde Dirección -> Pagos como cualquier otro.
 *
 * Usa el .env de la raíz de panel-direccion/ (el mismo de la app).
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mongoose = require('mongoose');

const Tournament = require('../models/Tournament');
const Transaction = require('../models/Transaction');
const Player = require('../models/Player');
const Pago = require('../models/Pago');
const { calcularPozo } = require('../utils/relojCalculos');

const CAJERO = 'Carga histórica';

// ------------------------------------------------------
// LECTURA DEL ARCHIVO
// ------------------------------------------------------

function leerTexto(archivo) {
  const buf = fs.readFileSync(archivo);
  let txt = buf.toString('utf8');
  // El Bloc de notas viejo guarda en "ANSI" (Windows-1252): si al leerlo
  // como UTF-8 aparecen caracteres rotos, se relee como latin1 (para que
  // "Muñoz" no quede "Mu�oz").
  if (txt.includes('�')) txt = buf.toString('latin1');
  return txt.replace(/^﻿/, '');
}

const pad = n => String(n).padStart(2, '0');

function fechaISO(dia, mes, anio) {
  const hoy = new Date();
  let a = anio ? Number(anio) : hoy.getFullYear();
  if (a < 100) a += 2000;
  if (!anio && new Date(a, mes - 1, dia) > hoy) a -= 1;
  const d = new Date(a, mes - 1, dia);
  if (d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return `${a}-${pad(mes)}-${pad(dia)}`;
}

// "943.500" / "943500" / "1.431.000" son válidos. Algo como "162.00"
// (le falta un cero) se marca como dudoso en vez de leerse mal.
function montoNum(s) {
  const t = String(s || '').trim();
  if (/^\d{1,3}(\.\d{3})+$/.test(t) || /^\d+$/.test(t)) return Number(t.replace(/\./g, ''));
  return NaN;
}

/**
 * Devuelve [{ torneo, fecha, linea, puesto, nombre, dni, monto }, ...]
 * y los avisos de líneas que no se entendieron.
 */
function parsear(texto) {
  const filas = [];
  const avisos = [];
  let torneo = '';
  let fecha = null;

  texto.split(/\r?\n/).forEach((raw, i) => {
    const linea = raw.trim();
    const n = i + 1;
    if (!linea) return;

    const mFecha = linea.match(/^(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?:\s*[\/\-.]\s*(\d{2,4}))?\s*:?\s*$/);
    if (mFecha) {
      fecha = fechaISO(Number(mFecha[1]), Number(mFecha[2]), mFecha[3]);
      if (!fecha) avisos.push(`Línea ${n}: fecha inválida "${linea}"`);
      return;
    }

    // Puesto: "1 : Nombre : $ 943.500", "1 Nombre : 943.500", "1 :" (vacío)...
    const mPremio = linea.match(/^(\d{1,3})\s*[:.\-)ºª°]*\s*(.*)$/);
    if (mPremio) {
      if (!torneo || !fecha) {
        avisos.push(`Línea ${n}: premio sin torneo o fecha arriba: "${linea}"`);
        return;
      }
      let resto = mPremio[2];
      let dni = '';
      const mDni = resto.match(/\bDNI\s*:?\s*([\d.]+)\s*$/i);
      if (mDni) { dni = mDni[1].replace(/\D/g, ''); resto = resto.slice(0, mDni.index); }
      let montoTxt = '';
      const mMonto = resto.match(/(?:^|[\s:$])\$?\s*(\d[\d.,]*)\s*$/);
      if (mMonto) { montoTxt = mMonto[1]; resto = resto.slice(0, mMonto.index); }
      const nombre = resto.replace(/[\s:$\-–]+$/, '').replace(/\s+/g, ' ').trim();
      filas.push({
        torneo,
        fecha,
        linea: n,
        puesto: Number(mPremio[1]),
        // "???" o vacío = ganador pendiente.
        nombre: /\p{L}/u.test(nombre) ? nombre : '',
        monto: montoNum(montoTxt),
        montoTxt,
        dni
      });
      return;
    }

    // Título de torneo: "Premios Funny Sundays", "Bounty Hunter -------"
    // (cualquier línea de texto sin números).
    if (!/\d/.test(linea) && /\p{L}/u.test(linea)) {
      torneo = linea.replace(/^premios?\s+/i, '').replace(/[\s:\-–—_=*]+$/, '').trim();
      fecha = null;
      return;
    }

    avisos.push(`Línea ${n}: no se entendió "${linea}"`);
  });

  return { filas, avisos };
}

// ------------------------------------------------------
// BÚSQUEDA DE TORNEO Y GANADOR
// ------------------------------------------------------

const norm = s => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();

const palabras = s => norm(s).split(' ').filter(Boolean);

async function buscarTorneo(fecha, nombre) {
  const delDia = await Tournament.find({ fecha }).lean();
  if (delDia.length <= 1) return { torneo: delDia[0] || null, delDia };
  const n = norm(nombre);
  const coinciden = delDia.filter(t => norm(t.nombre).includes(n) || n.includes(norm(t.nombre)));
  return { torneo: coinciden.length === 1 ? coinciden[0] : null, delDia };
}

function operacionesDe(torneo) {
  return Transaction.find({
    anulado: { $ne: true },
    $or: [
      { torneoId: torneo._id },
      { torneoId: null, torneo: torneo.nombre, fecha: torneo.fecha }
    ]
  }).lean();
}

/**
 * Busca al ganador entre los inscriptos del torneo.
 *  - exacto: mismas palabras (en cualquier orden).
 *  - aproximado: cada palabra escrita es el comienzo de una palabra del
 *    inscripto ("Leo Fernandez" -> "Leonardo Fernández"), y hay uno solo.
 */
function buscarGanador(nombre, inscriptos) {
  const escritas = palabras(nombre);
  if (!escritas.length) return { estado: 'sin-nombre' };

  const conPalabras = inscriptos.map(j => ({ j, p: palabras(j.nombre + ' ' + j.apellido) }));

  const exactos = conPalabras.filter(({ p }) =>
    p.length === escritas.length && escritas.every(w => p.includes(w)));
  if (exactos.length === 1) return { estado: 'exacto', jugador: exactos[0].j };
  if (exactos.length > 1) return { estado: 'ambiguo', candidatos: exactos.map(x => x.j) };

  const aprox = conPalabras.filter(({ p }) =>
    escritas.every(w => p.some(x => x.startsWith(w) || w.startsWith(x) && x.length >= 4)));
  if (aprox.length === 1) return { estado: 'aproximado', jugador: aprox[0].j };
  if (aprox.length > 1) return { estado: 'ambiguo', candidatos: aprox.map(x => x.j) };

  // Ninguno: se sugieren los que comparten alguna palabra.
  const parecidos = conPalabras
    .filter(({ p }) => escritas.some(w => w.length >= 4 && p.some(x => x.startsWith(w.slice(0, 4)))))
    .map(x => x.j)
    .slice(0, 4);
  return { estado: 'no-encontrado', candidatos: parecidos };
}

const fmt = n => '$' + Number(n || 0).toLocaleString('es-AR');
const quien = j => `${j.apellido} ${j.nombre} (DNI ${j.dni})`;

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(texto, r => { rl.close(); resolve(r); }));
}

// ------------------------------------------------------
// PRINCIPAL
// ------------------------------------------------------

async function main() {
  const archivo = process.argv.slice(2).find(a => !a.startsWith('--'));
  const confirmar = process.argv.includes('--confirmar');

  if (!archivo || !fs.existsSync(archivo)) {
    console.error('Uso: node backend/scripts/premios-historicos.js <archivo.txt> [--confirmar]');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('❌ No se encontró MONGODB_URI. Corré el script desde la carpeta panel-direccion/.');
    process.exit(1);
  }

  const { filas, avisos } = parsear(leerTexto(archivo));
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`✅ Conectado a MongoDB. ${filas.length} premios leídos de ${path.basename(archivo)}.\n`);

  const aCargar = [];
  const resumen = { cargar: 0, aproximados: 0, yaCargados: 0, sinNombre: 0, pendientes: 0 };

  // Agrupar por torneo + fecha, en orden de fecha.
  const grupos = new Map();
  for (const f of filas) {
    const k = f.fecha + '|' + f.torneo;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(f);
  }

  for (const [k, lista] of [...grupos.entries()].sort()) {
    const [fecha, nombreTorneo] = k.split('|');
    const { torneo, delDia } = await buscarTorneo(fecha, nombreTorneo);

    if (!torneo) {
      console.log(`❌ ${fecha} ${nombreTorneo}: ` + (delDia.length
        ? `ese día hay ${delDia.length} torneos (${delDia.map(t => t.nombre).join(' / ')}) y no se sabe cuál es.`
        : 'no hay ningún torneo cargado en esa fecha.'));
      resumen.pendientes += lista.length;
      continue;
    }

    const [ops, pagados] = await Promise.all([
      operacionesDe(torneo),
      Pago.find({ torneoId: torneo._id, tipo: 'premio', anulado: { $ne: true } }).lean()
    ]);
    const buyins = ops.filter(t => t.tipo === 'buyin');
    const inscriptos = [...new Map(buyins.map(t => [t.dni, t])).values()];
    const pozo = calcularPozo(ops, torneo).pozo;
    const puestosPagados = new Set(pagados.map(p => p.puesto));
    const suma = lista.reduce((s, f) => s + (f.monto > 0 ? f.monto : 0), 0);

    console.log(`📅 ${fecha} · ${torneo.nombre} · ${buyins.length} jugadores · pozo ${fmt(pozo)} · premios del archivo ${fmt(suma)}`);

    for (const f of lista.sort((a, b) => a.puesto - b.puesto)) {
      const pre = `   ${String(f.puesto).padStart(2)}º ${(f.monto > 0 ? fmt(f.monto) : '$ ?').padEnd(11)}`;

      if (puestosPagados.has(f.puesto)) {
        console.log(`${pre} ⏭  ya estaba cargado`);
        resumen.yaCargados++;
        continue;
      }
      if (!f.nombre && !f.dni) {
        console.log(`${pre} ·  sin nombre (pendiente)`);
        resumen.sinNombre++;
        continue;
      }
      if (!(f.monto > 0)) {
        console.log(`${pre} ❓ "${f.nombre}": ${f.montoTxt ? `monto dudoso "${f.montoTxt}"` : 'falta el monto'} (línea ${f.linea})`);
        resumen.pendientes++;
        continue;
      }

      let jugador = null;
      let nota = '';
      if (f.dni) {
        jugador = inscriptos.find(j => j.dni === f.dni) || await Player.findOne({ dni: f.dni }).lean();
        if (!jugador) {
          console.log(`${pre} ❓ "${f.nombre}": el DNI ${f.dni} no existe (línea ${f.linea})`);
          resumen.pendientes++;
          continue;
        }
        nota = inscriptos.some(j => j.dni === f.dni) ? 'por DNI' : 'por DNI (no figura inscripto ese día)';
      } else {
        const r = buscarGanador(f.nombre, inscriptos);
        if (r.estado === 'exacto' || r.estado === 'aproximado') {
          jugador = r.jugador;
          nota = r.estado === 'aproximado' ? 'APROXIMADO, revisalo' : '';
          if (r.estado === 'aproximado') resumen.aproximados++;
        } else {
          const cands = (r.candidatos || []).map(quien).join(' | ');
          console.log(`${pre} ❓ "${f.nombre}": ` +
            (r.estado === 'ambiguo' ? `hay más de uno: ${cands}` : 'no está entre los inscriptos' + (cands ? `. ¿Será: ${cands}?` : '')) +
            ` → agregá "DNI ..." en la línea ${f.linea}`);
          resumen.pendientes++;
          continue;
        }
      }

      const repetido = aCargar.find(p => String(p.torneoId) === String(torneo._id) && p.dni === jugador.dni);
      if (repetido) {
        console.log(`${pre} ❓ "${f.nombre}" → ${quien(jugador)}, pero ya figura en el ${repetido.puesto}º puesto de este torneo. Revisá la línea ${f.linea}`);
        resumen.pendientes++;
        continue;
      }

      console.log(`${pre} ✅ "${f.nombre}" → ${quien(jugador)}${nota ? '  [' + nota + ']' : ''}`);
      puestosPagados.add(f.puesto);
      resumen.cargar++;
      aCargar.push({
        tipo: 'premio',
        puesto: f.puesto,
        monto: f.monto,
        nombre: `${jugador.nombre} ${jugador.apellido}`,
        dni: jugador.dni,
        torneoId: torneo._id,
        torneo: torneo.nombre,
        fecha: torneo.fecha,
        hora: '-',
        cajero: CAJERO,
        calculo: {
          pozo,
          jugadores: buyins.length,
          porcentaje: pozo > 0 ? Math.round((f.monto / pozo) * 1000) / 10 : 0
        }
      });
    }
    console.log('');
  }

  if (avisos.length) {
    console.log('⚠️  Líneas que no se entendieron (no se cargan):');
    avisos.forEach(a => console.log('   ' + a));
    console.log('');
  }

  console.log(`Resumen: ${resumen.cargar} para cargar (${resumen.aproximados} aproximados) · ` +
    `${resumen.yaCargados} ya cargados · ${resumen.sinNombre} sin nombre · ${resumen.pendientes} para revisar`);

  if (!aCargar.length) {
    console.log('\nNo hay nada nuevo para cargar.');
    return mongoose.disconnect();
  }
  if (!confirmar) {
    console.log('\n🔎 Modo prueba: no se cargó nada. Revisá sobre todo los APROXIMADOS y, si está bien, corré de nuevo con --confirmar');
    return mongoose.disconnect();
  }

  const r = await preguntar(`\n⚠️  Se van a cargar ${aCargar.length} premios en la base REAL. Escribí CONFIRMAR para seguir: `);
  if (r.trim() !== 'CONFIRMAR') {
    console.log('Cancelado. No se cargó nada.');
    return mongoose.disconnect();
  }

  let ok = 0;
  for (const p of aCargar) {
    try {
      await Pago.create(p);
      ok++;
    } catch (err) {
      // Por si Caja pagó ese puesto mientras tanto (índice único).
      console.log(`   ⏭  ${p.fecha} ${p.puesto}º: ${err.code === 11000 ? 'ya estaba cargado' : err.message}`);
    }
  }
  console.log(`\n✅ Listo: ${ok} premios cargados (cajero "${CAJERO}").`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
}

module.exports = { parsear, buscarGanador };
