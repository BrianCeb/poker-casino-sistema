const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const Tournament = require('../models/Tournament');
const { requireAuth, requireRole } = require('../middleware/auth');
const { diaOperativo } = require('../utils/diaOperativo');

function restarDias(fechaStr, dias) {
  const d = new Date(fechaStr + 'T00:00:00');
  d.setDate(d.getDate() - dias);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

router.get('/resumen', requireAuth, requireRole('direccion', 'gerencia'), async (req, res) => {
  try {
    const hasta = req.query.hasta || diaOperativo();
    const desde = req.query.desde || restarDias(hasta, 6);

    const txs = await Transaction.find({
      fecha: { $gte: desde, $lte: hasta },
      anulado: { $ne: true }
    }).lean();

    const totalRecaudado = txs.reduce((s, t) => s + Number(t.monto || 0), 0);
    const buyins = txs.filter(t => t.tipo === 'buyin').length;
    const recompras = txs.filter(t => t.tipo === 'recompra').length;
    const dnisUnicos = new Set(txs.map(t => t.dni));
    const totalJugadores = dnisUnicos.size;

    // NUEVOS vs RECURRENTES - basado en la primera compra de toda la
    // historia de cada jugador, no en su fecha de registro.
    const primeraFechaPorJugador = await Transaction.aggregate([
      { $match: { dni: { $in: [...dnisUnicos] }, anulado: { $ne: true } } },
      { $group: { _id: '$dni', primeraFecha: { $min: '$fecha' } } }
    ]);
    const jugadoresNuevos = primeraFechaPorJugador.filter(
      p => p.primeraFecha >= desde && p.primeraFecha <= hasta
    ).length;
    const jugadoresRecurrentes = totalJugadores - jugadoresNuevos;

    // TASA DE RECOMPRA: de los que hicieron al menos un buy-in, que
    // porcentaje volvio a comprar (al menos una recompra) en el periodo.
    const dnisConBuyin = new Set(txs.filter(t => t.tipo === 'buyin').map(t => t.dni));
    const dnisConRecompra = new Set(txs.filter(t => t.tipo === 'recompra').map(t => t.dni));
    const tasaRecompra = dnisConBuyin.size > 0
      ? Math.round((dnisConRecompra.size / dnisConBuyin.size) * 100)
      : 0;

    // AGRUPAR POR TORNEO (rake real + datos para el grafico "por torneo")
    const torneoIds = [...new Set(txs.filter(t => t.torneoId).map(t => String(t.torneoId)))];
    const torneosDocs = torneoIds.length
      ? await Tournament.find({ _id: { $in: torneoIds } }).lean()
      : [];
    const torneoInfoMap = {};
    torneosDocs.forEach(t => { torneoInfoMap[String(t._id)] = t; });

    const porTorneo = {};
    txs.forEach(t => {
      const key = t.torneoId ? String(t.torneoId) : `sin-torneo:${t.torneo}`;
      if (!porTorneo[key]) {
        porTorneo[key] = {
          nombre: t.torneo,
          fecha: t.torneoId && torneoInfoMap[key] ? torneoInfoMap[key].fecha : t.fecha,
          recaudado: 0,
          buyins: 0,
          recompras: 0,
          jugadoresSet: new Set()
        };
      }
      porTorneo[key].recaudado += Number(t.monto || 0);
      if (t.tipo === 'buyin') porTorneo[key].buyins++; else porTorneo[key].recompras++;
      porTorneo[key].jugadoresSet.add(t.dni);
    });

    const torneosDetalle = Object.entries(porTorneo).map(([key, g]) => {
      const info = torneoInfoMap[key];
      const rakePorOperacion = info ? Number(info.rake || 0) : 0;
      const rake = (g.buyins + g.recompras) * rakePorOperacion;
      const premios = Math.max(0, g.recaudado - rake);
      return {
        nombre: g.nombre,
        fecha: g.fecha,
        buyins: g.buyins,
        recompras: g.recompras,
        recaudado: g.recaudado,
        rake,
        premios,
        // Se usa para el grafico "Jugadores por torneo", no para la tabla
        // (la tabla de Detalle por torneo no lo muestra a proposito).
        jugadores: g.jugadoresSet.size
      };
    }).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    const rakeAcumulado = torneosDetalle.reduce((s, t) => s + t.rake, 0);
    const premiosEntregados = Math.max(0, totalRecaudado - rakeAcumulado);

    res.json({
      desde, hasta,
      totalRecaudado, rakeAcumulado, premiosEntregados,
      buyins, recompras, tasaRecompra,
      totalJugadores, jugadoresNuevos, jugadoresRecurrentes,
      torneosDetalle
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al generar el resumen.', detalle: err.message });
  }
});

module.exports = router;