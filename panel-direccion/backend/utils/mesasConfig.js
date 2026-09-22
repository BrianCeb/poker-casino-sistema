const Config = require('../models/Config');

const CLAVE = 'cantidadMesas';
const DEFAULT_CANTIDAD_MESAS = 13;

async function getCantidadMesas() {
  const doc = await Config.findOne({ clave: CLAVE }).lean();
  const valor = doc ? Number(doc.valor) : DEFAULT_CANTIDAD_MESAS;
  return (Number.isInteger(valor) && valor > 0) ? valor : DEFAULT_CANTIDAD_MESAS;
}

async function setCantidadMesas(nuevaCantidad) {
  await Config.findOneAndUpdate(
    { clave: CLAVE },
    { clave: CLAVE, valor: nuevaCantidad },
    { upsert: true }
  );
}

module.exports = { getCantidadMesas, setCantidadMesas, DEFAULT_CANTIDAD_MESAS };