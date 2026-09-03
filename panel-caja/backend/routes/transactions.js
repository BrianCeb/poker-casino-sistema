const express = require('express');
const Player = require('../models/Player');
const Transaction = require('../models/Transaction');
const Tournament = require('../models/Tournament');
const { requireAuth, requireRole } = require('../middleware/auth');
const { diaOperativo } = require('../utils/diaOperativo');

const router = express.Router();

function nowTimeStr() {
  const d = new Date();

  return (
    String(d.getHours()).padStart(2, '0') +
    ':' +
    String(d.getMinutes()).padStart(2, '0')
  );
}

router.post('/', requireAuth, requireRole('caja'), async (req, res) => {
  try {
    const {
      dni,
      monto,
      cajero
    } = req.body || {};

    const cleanDni = String(dni || '').replace(/\D/g, '');
    const amount = Number(monto);

    if (
      !cleanDni ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        error: 'DNI y un monto válido son obligatorios.'
      });
    }

    const player = await Player.findOne({
      dni: cleanDni,
      activo: { $ne: false }
    });

    if (!player) {
      return res.status(404).json({
        error: 'El jugador no está registrado.'
      });
    }

    const torneo = await Tournament
      .findOne({ activo: true })
      .sort({ createdAt: -1 });

    if (!torneo) {
      return res.status(409).json({
        error: 'No hay un torneo activo configurado por Dirección.'
      });
    }

    // IMPORTANTE:
    // Todas las operaciones utilizan el día operativo del casino.
    // El día cambia a las 06:00, no a las 00:00.
    const fechaOperativa = diaOperativo();

    const buyinExists = await Transaction.exists({
      dni: cleanDni,
      fecha: fechaOperativa,
      tipo: 'buyin',
      anulado: { $ne: true }
    });

    const tipo = buyinExists
      ? 'recompra'
      : 'buyin';

    if (
      tipo === 'buyin' &&
      amount !== Number(torneo.buyIn)
    ) {
      return res.status(400).json({
        error: `El monto del buy-in debe ser ${torneo.buyIn}.`
      });
    }

    if (
      tipo === 'recompra' &&
      amount !== Number(torneo.recompra)
    ) {
      return res.status(400).json({
        error: `El monto de la recompra debe ser ${torneo.recompra}.`
      });
    }

    try {
      const tx = await Transaction.create({
        dni: cleanDni,
        nombre: player.nombre,
        apellido: player.apellido,
        tipo,
        monto: amount,
        torneoId: torneo._id,
        torneo: torneo.nombre,
        fecha: fechaOperativa,
        hora: nowTimeStr(),
        cajero: String(cajero || '').trim()
      });

      return res.status(201).json(tx);

    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          error:
            'Este jugador ya tiene un buy-in registrado para el día operativo actual. La operación no fue duplicada.'
        });
      }

      throw err;
    }

  } catch (err) {
    console.error('Error al registrar operación en Caja:', err);

    res.status(500).json({
      error: 'Error al registrar la operación.'
    });
  }
});

module.exports = router;