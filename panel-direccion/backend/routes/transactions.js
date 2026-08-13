const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Direccion solo consulta el control del dia. El registro de compras
// (POST) es exclusivo de la app de Caja: no existe ese endpoint aca.
router.get('/today', async (req, res) => {
  try {
    const today = todayStr();
    const txs = await Transaction.find({ fecha: today }).sort({ createdAt: -1 });
    const buyins = txs.filter(t => t.tipo === 'buyin');
    const recompras = txs.filter(t => t.tipo === 'recompra');
    const total = txs.reduce((s, t) => s + t.monto, 0);
    const jugadoresUnicos = new Set(txs.map(t => t.dni)).size;

    res.json({
      fecha: today,
      transacciones: txs,
      stats: { jugadores: jugadoresUnicos, buyins: buyins.length, recompras: recompras.length, total }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener el control del dia.', detalle: err.message });
  }
});

module.exports = router;
