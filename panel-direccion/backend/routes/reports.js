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

    // AGRUPAR POR TORNEO — se agrupa por FECHA (la fecha real de cada
    // transaccion), no por torneoId. Antes, si un dia arrancaba sin
    // configurar un torneo nuevo, las transacciones quedaban con el
    // torneoId del ultimo torneo activo (de otra fecha), y ese dia
    // terminaba mezclado/oculto bajo la fecha del torneo viejo.
    const fechasUnicas = [...new Set(txs.map(t => t.fecha))];
    const torneosDocs = fechasUnicas.length
      ? await Tournament.find({ fecha: { $in: fechasUnicas } }).sort({ createdAt: -1 }).lean()
      : [];
    const torneoInfoPorFecha = {};
    torneosDocs.forEach(t => {
      // Si hubiera mas de un Tournament con la misma fecha, nos
      // quedamos con el mas reciente (por el sort de arriba).
      if (!torneoInfoPorFecha[t.fecha]) torneoInfoPorFecha[t.fecha] = t;
    });

    const porTorneo = {};
    txs.forEach(t => {
      const key = t.fecha;
      const info = torneoInfoPorFecha[key];
      if (!porTorneo[key]) {
        porTorneo[key] = {
          nombre: info ? info.nombre : t.torneo,
          fecha: t.fecha,
          recaudado: 0,
          buyins: 0,
          recompras: 0,
          jugadoresSet: new Set(),
          // Mistery Bounty: acumulamos el desglose real guardado en cada
          // transaccion (Transaction.desglose), no un rake fijo por
          // operacion.
          tipo: info && info.tipo === 'mistery_bounty' ? 'mistery_bounty' : 'normal',
          rakeMB: 0,
          bountyMB: 0
        };
      }
      porTorneo[key].recaudado += Number(t.monto || 0);
      if (t.tipo === 'buyin') porTorneo[key].buyins++; else porTorneo[key].recompras++;
      porTorneo[key].jugadoresSet.add(t.dni);

      if (porTorneo[key].tipo === 'mistery_bounty') {
        const d = t.desglose || {};
        porTorneo[key].rakeMB += Number(d.rake || 0);
        porTorneo[key].bountyMB += Number(d.bounty || 0);
      }
    });

    const torneosDetalle = Object.entries(porTorneo).map(([key, g]) => {
      const info = torneoInfoPorFecha[key];
      let rake;
      let bounty;

      if (g.tipo === 'mistery_bounty') {
        // Valores reales, sumados desde el desglose de cada transaccion.
        rake = g.rakeMB;
        bounty = g.bountyMB;
      } else {
        const rakePorOperacion = info ? Number(info.rake || 0) : 0;
        rake = (g.buyins + g.recompras) * rakePorOperacion;
        bounty = 0;
      }

      // "premios" (prizepool) es lo que queda despues de sacar la
      // comision del casino (rake) y, si aplica, el bounty (que no es
      // comision del casino, se destina aparte).
      const premios = Math.max(0, g.recaudado - rake - bounty);

      return {
        nombre: g.nombre,
        fecha: g.fecha,
        tipo: g.tipo,
        buyins: g.buyins,
        recompras: g.recompras,
        recaudado: g.recaudado,
        rake,
        bounty,
        premios,
        // Se usa para el grafico "Jugadores por torneo", no para la tabla
        // (la tabla de Detalle por torneo no lo muestra a proposito).
        jugadores: g.jugadoresSet.size
      };
    }).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    const rakeAcumulado = torneosDetalle.reduce((s, t) => s + t.rake, 0);
    // Informativo: no es comision del casino, la comision sigue siendo
    // solo el rake.
    const bountyAcumulado = torneosDetalle.reduce((s, t) => s + (t.bounty || 0), 0);
    const premiosEntregados = Math.max(0, totalRecaudado - rakeAcumulado - bountyAcumulado);

    res.json({
      desde, hasta,
      totalRecaudado, rakeAcumulado, bountyAcumulado, premiosEntregados,
      buyins, recompras, tasaRecompra,
      totalJugadores, jugadoresNuevos, jugadoresRecurrentes,
      torneosDetalle
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al generar el resumen.', detalle: err.message });
  }
});

module.exports = router;