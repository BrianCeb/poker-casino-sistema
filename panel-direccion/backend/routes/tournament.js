const express = require('express');
const router = express.Router();
const Tournament = require('../models/Tournament');
const requireDireccion = require('../middleware/requireDireccion');

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

router.get('/', async (req, res) => {
  try {
    const activo = await Tournament.findOne().sort({ createdAt: -1 });
    if (!activo) return res.json({ nombre: 'Sin configurar', buyIn: 0, recompra: 0, fecha: todayStr() });
    res.json(activo);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener el torneo.', detalle: err.message });
  }
});

router.post('/', requireDireccion, async (req, res) => {
  try {
    const { nombre, buyIn, recompra } = req.body;
    if (!nombre || buyIn == null || recompra == null) {
      return res.status(400).json({ error: 'Nombre, buyIn y recompra son obligatorios.' });
    }
    const nuevo = await Tournament.create({ nombre, buyIn, recompra, fecha: todayStr() });
    res.status(201).json(nuevo);
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar el torneo.', detalle: err.message });
  }
});

module.exports = router;
