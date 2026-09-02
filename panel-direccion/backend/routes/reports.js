const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const Player = require('../models/Player');
const { requireAuth, requireRole } = require('../middleware/auth');
const { diaOperativo } = require('../utils/diaOperativo');

function restarDias(fechaStr, dias) {
  const d = new Date(fechaStr + 'T00:00:00');
  d.setDate(d.getDate() - dias);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// GET /api/reports/resumen?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Solo lectura, pensado para Gerencia (y Direccion tambien puede verlo).
// Si no se pasan fechas, muestra los ultimos 7 dias operativos.
router.get('/resumen', requireAuth, requireRole('direccion', 'gerencia'), async (req, res) => {
  try {
    const hasta = req.query.hasta || diaOperativo();
    const desde = req.query.desde || restarDias(hasta, 6);

    const txs = await Transaction.find({
      fecha: { $gte: desde, $lte: hasta },
      anulado: { $ne: true }
    });

    const totalRecaudado = txs.reduce((s, t) => s + Number(t.monto || 0), 0);
    const buyins = txs.filter(t => t.tipo === 'buyin').length;
    const recompras = txs.filter(t => t.tipo === 'recompra').length;
    const dnisUnicos = new Set(txs.map(t => t.dni));
    const totalJugadores = dnisUnicos.size;

    const jugadoresNuevos = await Player.countDocuments({
      dni: { $in: [...dnisUnicos] },
      fechaAlta: { $gte: new Date(desde + 'T00:00:00'), $lte: new Date(hasta + 'T23:59:59') }
    });
    const jugadoresRecurrentes = totalJugadores - jugadoresNuevos;

    const porDia = {};
    txs.forEach(t => {
      if (!porDia[t.fecha]) porDia[t.fecha] = { fecha: t.fecha, total: 0, jugadoresSet: new Set() };
      porDia[t.fecha].total += Number(t.monto || 0);
      porDia[t.fecha].jugadoresSet.add(t.dni);
    });
    const serieDiaria = Object.values(porDia)
      .map(d => ({ fecha: d.fecha, total: d.total, jugadores: d.jugadoresSet.size }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));

    res.json({
      desde, hasta, totalRecaudado, buyins, recompras,
      totalJugadores, jugadoresNuevos, jugadoresRecurrentes, serieDiaria
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al generar el resumen.', detalle: err.message });
  }
});

module.exports = router;