const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const Transaction = require('../models/Transaction');
const requireDireccion = require('../middleware/requireDireccion');

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

router.post('/', requireDireccion, async (req, res) => {
  try {
    const { dni, nombre, apellido, telefono, email } = req.body;
    if (!dni || !nombre || !apellido) {
      return res.status(400).json({ error: 'DNI, nombre y apellido son obligatorios.' });
    }
    const existente = await Player.findOne({ dni });
    if (existente) {
      return res.status(409).json({ error: 'Ese DNI ya esta registrado.' });
    }
    const player = await Player.create({ dni, nombre, apellido, telefono, email });
    res.status(201).json(player);
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar el jugador.', detalle: err.message });
  }
});

router.get('/:dni', async (req, res) => {
  try {
    const dni = req.params.dni.replace(/\D/g, '');
    const player = await Player.findOne({ dni });
    if (!player) return res.status(404).json({ registrado: false });

    const today = todayStr();
    const txHoy = await Transaction.find({ dni, fecha: today }).sort({ createdAt: 1 });
    const yaCompro = txHoy.length > 0;
    res.json({
      registrado: true,
      player,
      yaCompro,
      recomprasCount: yaCompro ? txHoy.length - 1 : 0,
      accionCorrespondiente: yaCompro ? 'recompra' : 'buyin'
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al buscar el jugador.', detalle: err.message });
  }
});

module.exports = router;
