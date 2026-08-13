const express = require('express');
const router = express.Router();
const Tournament = require('../models/Tournament');

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Caja solo lee la configuracion del torneo. No existe POST en este build:
// el monto de buy-in/recompra solo lo puede cambiar la app de Direccion.
router.get('/', async (req, res) => {
  try {
    const activo = await Tournament.findOne().sort({ createdAt: -1 });
    if (!activo) return res.json({ nombre: 'Sin configurar', buyIn: 0, recompra: 0, fecha: todayStr() });
    res.json(activo);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener el torneo.', detalle: err.message });
  }
});

module.exports = router;
