const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const Transaction = require('../models/Transaction');
const Tournament = require('../models/Tournament');

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function nowTimeStr() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// El tipo (buyin/recompra) lo decide siempre el backend contando los
// movimientos del dia, nunca lo que mande el cliente. Esto es lo que
// impide que se pueda forzar un buy-in repetido desde la app.
router.post('/', async (req, res) => {
  try {
    const { dni, monto, cajero } = req.body;
    if (!dni || monto == null) {
      return res.status(400).json({ error: 'DNI y monto son obligatorios.' });
    }
    const player = await Player.findOne({ dni });
    if (!player) return res.status(404).json({ error: 'El jugador no esta registrado.' });

    const torneoActivo = await Tournament.findOne().sort({ createdAt: -1 });
    const nombreTorneo = torneoActivo ? torneoActivo.nombre : 'Sin configurar';

    const today = todayStr();
    const txHoy = await Transaction.countDocuments({ dni, fecha: today });
    const tipo = txHoy === 0 ? 'buyin' : 'recompra';

    const tx = await Transaction.create({
      dni, nombre: player.nombre, apellido: player.apellido, tipo, monto,
      torneo: nombreTorneo, fecha: today, hora: nowTimeStr(), cajero: cajero || ''
    });
    res.status(201).json(tx);
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar la operacion.', detalle: err.message });
  }
});

module.exports = router;
