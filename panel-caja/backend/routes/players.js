const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const Transaction = require('../models/Transaction');

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Caja NUNCA da de alta jugadores. Ese endpoint (POST) directamente no
// existe en este build: aunque alguien intente forzarlo, Express responde
// 404 porque la ruta no esta registrada.
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
