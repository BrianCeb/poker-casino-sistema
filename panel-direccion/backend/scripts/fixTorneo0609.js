// Migración de una sola vez: crea el Tournament faltante del 06/09
// (Funny Sundays) para que Panel Gerencia pueda calcular el
// desglose de rake/premios de ese día correctamente.
//
// No toca transacciones existentes, no toca el torneo activo actual.
// Se crea con activo: false porque no debe interferir con el torneo
// que esté activo hoy en producción.
//
// Uso: node backend/scripts/fixTorneo0609.js   (desde panel-direccion/)

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Tournament = require('../models/Tournament');

const FECHA_TORNEO = '2026-09-06';

const DATOS_TORNEO = {
  nombre: 'Funny Sundays',
  buyIn: 30000,
  recompra: 30000,
  rake: 5000,
  fecha: FECHA_TORNEO,
  activo: false
};

async function fix() {
  const existente = await Tournament.findOne({ fecha: FECHA_TORNEO });

  if (existente) {
    console.log(`Ya existe un Tournament con fecha ${FECHA_TORNEO} (id: ${existente._id}). No se crea nada, para no duplicar.`);
    return;
  }

  const creado = await Tournament.create(DATOS_TORNEO);

  console.log('Torneo creado correctamente:');
  console.log({
    id: creado._id.toString(),
    nombre: creado.nombre,
    fecha: creado.fecha,
    buyIn: creado.buyIn,
    recompra: creado.recompra,
    rake: creado.rake,
    activo: creado.activo
  });
}

connectDB()
  .then(fix)
  .then(() => mongoose.disconnect())
  .catch(err => {
    console.error('Error al ejecutar el fix:', err.message);
    process.exit(1);
  });