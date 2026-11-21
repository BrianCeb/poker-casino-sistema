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

// "Funny Sundays" / "FUNNY SUNDAYS " / "Funny Sundáys" -> "funny sundays"
function normalizarNombre(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

// Nombres de torneos jugados (toda la historia), sin repetir: para el
// selector de Gerencia. Si un nombre se escribio de varias formas, se
// muestra la mas usada.
async function torneosDisponibles() {
  const docs = await Tournament.find({}, 'nombre').lean();
  const grupos = new Map();
  for (const t of docs) {
    const k = normalizarNombre(t.nombre);
    if (!k) continue;
    if (!grupos.has(k)) grupos.set(k, new Map());
    const variantes = grupos.get(k);
    const nombre = String(t.nombre).replace(/\s+/g, ' ').trim();
    variantes.set(nombre, (variantes.get(nombre) || 0) + 1);
  }
  return [...grupos.values()]
    .map(v => [...v.entries()].sort((a, b) => b[1] - a[1])[0][0])
    .sort((a, b) => a.localeCompare(b, 'es'));
}

router.get('/resumen', requireAuth, requireRole('direccion', 'gerencia'), async (req, res) => {
  try {
    const hasta = req.query.hasta || diaOperativo();
    const desde = req.query.desde || restarDias(hasta, 6);

    const txsPeriodo = await Transaction.find({
      fecha: { $gte: desde, $lte: hasta },
      anulado: { $ne: true }
    }).lean();

    // AGRUPAR POR TORNEO — se agrupa por FECHA (la fecha real de cada
    // transaccion), no por torneoId. Antes, si un dia arrancaba sin
    // configurar un torneo nuevo, las transacciones quedaban con el
    // torneoId del ultimo torneo activo (de otra fecha), y ese dia
    // terminaba mezclado/oculto bajo la fecha del torneo viejo.
    const fechasPeriodo = [...new Set(txsPeriodo.map(t => t.fecha))];
    const torneosDocs = fechasPeriodo.length
      ? await Tournament.find({ fecha: { $in: fechasPeriodo } }).sort({ createdAt: -1 }).lean()
      : [];
    const torneoInfoPorFecha = {};
    torneosDocs.forEach(t => {
      // Si hubiera mas de un Tournament con la misma fecha, nos
      // quedamos con el mas reciente (por el sort de arriba).
      if (!torneoInfoPorFecha[t.fecha]) torneoInfoPorFecha[t.fecha] = t;
    });

    // FILTRO POR NOMBRE DE TORNEO (opcional): ?torneo=Funny Sundays
    // Se quedan solo las fechas cuyo torneo se llama asi (sin distinguir
    // mayusculas ni tildes) y TODO el resumen se calcula con esas fechas.
    const filtroTorneo = normalizarNombre(req.query.torneo);
    const nombreDeFecha = (fecha, t) => {
      const info = torneoInfoPorFecha[fecha];
      return info ? info.nombre : (t && t.torneo) || '';
    };
    const txs = filtroTorneo
      ? txsPeriodo.filter(t => normalizarNombre(nombreDeFecha(t.fecha, t)) === filtroTorneo)
      : txsPeriodo;

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
          bountyMB: 0,
          hunterMB: 0
        };
      }
      porTorneo[key].recaudado += Number(t.monto || 0);
      if (t.tipo === 'buyin') porTorneo[key].buyins++; else porTorneo[key].recompras++;
      porTorneo[key].jugadoresSet.add(t.dni);

      if (porTorneo[key].tipo === 'mistery_bounty') {
        const d = t.desglose || {};
        porTorneo[key].rakeMB += Number(d.rake || 0);
        porTorneo[key].bountyMB += Number(d.bounty || 0);
        porTorneo[key].hunterMB += Number(d.hunter || 0);
      }
    });

    const torneosDetalle = Object.entries(porTorneo).map(([key, g]) => {
      const info = torneoInfoPorFecha[key];
      let rake;
      let bounty;
      let hunter = 0;

      if (g.tipo === 'mistery_bounty') {
        // Valores reales, sumados desde el desglose de cada transaccion.
        rake = g.rakeMB;
        bounty = g.bountyMB;
        hunter = g.hunterMB;
      } else {
        const rakePorOperacion = info ? Number(info.rake || 0) : 0;
        rake = (g.buyins + g.recompras) * rakePorOperacion;
        bounty = 0;
      }

      // "premios" (prizepool) es lo que queda despues de sacar la
      // comision del casino (rake) y, si aplica, el bounty (que no es
      // comision del casino, se destina aparte).
      // El Hunter tampoco va al pozo: es la bolsa del premio al que mas
      // bounties cobra. En los graficos de Gerencia se suma al bounty.
      const premios = Math.max(0, g.recaudado - rake - bounty - hunter);

      return {
        nombre: g.nombre,
        fecha: g.fecha,
        tipo: g.tipo,
        buyins: g.buyins,
        recompras: g.recompras,
        recaudado: g.recaudado,
        rake,
        bounty: bounty + hunter,
        hunter,
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
      torneo: req.query.torneo || '',
      torneosDisponibles: await torneosDisponibles(),
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