const express = require('express');
const Tournament = require('../models/Tournament');
const Transaction = require('../models/Transaction');
const RelojTorneo = require('../models/RelojTorneo');
const Pago = require('../models/Pago');
const { requireAuth, requireRole } = require('../middleware/auth');
const { diaOperativo } = require('../utils/diaOperativo');
const { calcularPozo, porcentajesPremios, montosPremios } = require('../utils/premiosCalculos');

const router = express.Router();

const MAX_BOUNTIES_POR_PAGO = 30;

function nowTimeStr() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

async function torneoActivo() {
  // lean(): trae tambien "rake", que el modelo Tournament de Caja no
  // declara pero Direccion si guarda (lo necesita el calculo del pozo).
  return Tournament.findOne({ activo: true }).sort({ createdAt: -1 }).lean();
}

// ------------------------------------------------------
// PREMIOS DEL TORNEO ACTIVO
// ------------------------------------------------------
// Mismos datos que usa el reloj REAL (routes/reloj.js de Direccion):
// operaciones del dia operativo sin anular + configuracion de premios
// del RelojTorneo del torneo. Si Direccion esta en modo prueba, aca se
// ignora: Caja siempre paga con los numeros reales.
async function calcularPremios(torneo) {
  const [transacciones, reloj] = await Promise.all([
    Transaction.find({ fecha: diaOperativo(), anulado: { $ne: true } })
      .select('tipo monto desglose dni nombre apellido')
      .lean(),
    RelojTorneo.findOne({ torneoId: torneo._id }).lean()
  ]);

  // Si el reloj todavia no se abrio nunca para este torneo, se usan los
  // mismos valores por defecto que tiene el modelo del reloj.
  const config = {
    porcentajePagados: reloj && reloj.porcentajePagados != null ? reloj.porcentajePagados : 12.5,
    redondeoPremios: reloj && reloj.redondeoPremios != null ? reloj.redondeoPremios : 1000,
    premios: (reloj && reloj.premios) || []
  };

  const buyins = transacciones.filter(t => t.tipo === 'buyin');
  const pozo = calcularPozo(transacciones, torneo);
  const { origen, porcentajes } = porcentajesPremios(buyins.length, config);
  const premios = montosPremios(pozo.pozo, porcentajes, config.redondeoPremios)
    .map((p, i) => ({ puesto: i + 1, ...p }));

  return {
    jugadores: buyins.length,
    reentradas: transacciones.length - buyins.length,
    pozo: pozo.pozo,
    bolsaBounty: pozo.bounty,
    premios,
    origen,
    // Inscriptos de hoy (para sugerir el nombre al pagar y completar el DNI).
    inscriptos: buyins
      .map(t => ({ dni: t.dni, nombre: t.nombre, apellido: t.apellido }))
      .sort((a, b) => (a.apellido + a.nombre).localeCompare(b.apellido + b.nombre, 'es'))
  };
}

function limpiarNombre(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}


// GET /api/pagos/resumen -> tabla de premios con lo ya pagado, bounties
// pagados y pagos del dia.
router.get('/resumen', requireAuth, requireRole('caja'), async (req, res) => {
  try {
    const torneo = await torneoActivo();
    if (!torneo) return res.json({ sinTorneo: true });

    const [calc, pagos] = await Promise.all([
      calcularPremios(torneo),
      Pago.find({ torneoId: torneo._id, anulado: { $ne: true } }).sort({ createdAt: -1 }).lean()
    ]);

    const pagosPremio = new Map(pagos.filter(p => p.tipo === 'premio').map(p => [p.puesto, p]));
    const bounties = pagos.filter(p => p.tipo === 'bounty');

    res.json({
      torneo: { id: torneo._id, nombre: torneo.nombre, tipo: torneo.tipo || 'normal', fecha: torneo.fecha },
      torneoDeOtroDia: torneo.fecha !== diaOperativo(),
      jugadores: calc.jugadores,
      reentradas: calc.reentradas,
      pozo: calc.pozo,
      origen: calc.origen,
      premios: calc.premios.map(p => {
        const pago = pagosPremio.get(p.puesto);
        return {
          ...p,
          pagado: !!pago,
          // Si ya se pago, se muestra lo que se pago (puede diferir si el
          // pozo cambio despues, por ejemplo por una anulacion).
          montoPagado: pago ? pago.monto : null,
          nombre: pago ? pago.nombre : '',
          hora: pago ? pago.hora : ''
        };
      }),
      bounty: {
        bolsa: calc.bolsaBounty,
        pagado: bounties.reduce((s, p) => s + Number(p.monto || 0), 0),
        cantidad: bounties.length
      },
      inscriptos: calc.inscriptos,
      pagos
    });
  } catch (err) {
    console.error('Error obteniendo resumen de pagos:', err);
    res.status(500).json({ error: 'Error al obtener los premios.' });
  }
});


// POST /api/pagos/premio  { puesto, nombre, dni? }
// El monto NO lo manda la pantalla: se recalcula aca en el momento del
// pago, para que sea siempre el mismo que muestra el reloj.
router.post('/premio', requireAuth, requireRole('caja'), async (req, res) => {
  try {
    const puesto = Number((req.body || {}).puesto);
    const nombre = limpiarNombre((req.body || {}).nombre);
    const dni = String((req.body || {}).dni || '').replace(/\D/g, '');

    if (!Number.isInteger(puesto) || puesto < 1) return res.status(400).json({ error: 'Puesto inválido.' });
    if (nombre.length < 2) return res.status(400).json({ error: 'Ingresá el nombre del jugador que cobra.' });

    const torneo = await torneoActivo();
    if (!torneo) return res.status(409).json({ error: 'No hay un torneo activo configurado por Dirección.' });

    const calc = await calcularPremios(torneo);
    const premio = calc.premios.find(p => p.puesto === puesto);
    if (!premio) {
      return res.status(400).json({ error: `Con ${calc.jugadores} jugadores el puesto ${puesto} no cobra premio.` });
    }
    if (!(premio.monto > 0)) return res.status(400).json({ error: 'El premio de ese puesto es $0. Revisá el pozo del torneo.' });

    try {
      const pago = await Pago.create({
        tipo: 'premio',
        puesto,
        monto: premio.monto,
        nombre,
        dni,
        torneoId: torneo._id,
        torneo: torneo.nombre,
        fecha: diaOperativo(),
        hora: nowTimeStr(),
        cajero: String(req.user.username || (req.body || {}).cajero || '').trim(),
        calculo: { pozo: calc.pozo, jugadores: calc.jugadores, porcentaje: premio.porcentaje }
      });
      return res.status(201).json(pago);
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: `El puesto ${puesto} ya fue pagado. Si hubo un error, lo tiene que anular Dirección.` });
      }
      throw err;
    }
  } catch (err) {
    console.error('Error registrando pago de premio:', err);
    res.status(500).json({ error: 'Error al registrar el pago del premio.' });
  }
});


// POST /api/pagos/bounty  { nombre, dni?, montos: [n, n, ...] }
// Un documento (y un ticket) por cada bounty cobrado.
router.post('/bounty', requireAuth, requireRole('caja'), async (req, res) => {
  try {
    const body = req.body || {};
    const nombre = limpiarNombre(body.nombre);
    const dni = String(body.dni || '').replace(/\D/g, '');
    const montos = Array.isArray(body.montos) ? body.montos.map(Number) : [];

    if (nombre.length < 2) return res.status(400).json({ error: 'Ingresá el nombre del jugador que cobra.' });
    if (!montos.length) return res.status(400).json({ error: 'Indicá al menos un bounty.' });
    if (montos.length > MAX_BOUNTIES_POR_PAGO) {
      return res.status(400).json({ error: `Máximo ${MAX_BOUNTIES_POR_PAGO} bounties por pago.` });
    }
    const invalido = montos.findIndex(m => !Number.isFinite(m) || m <= 0 || !Number.isInteger(m));
    if (invalido !== -1) return res.status(400).json({ error: `El monto del bounty ${invalido + 1} no es válido.` });

    const torneo = await torneoActivo();
    if (!torneo) return res.status(409).json({ error: 'No hay un torneo activo configurado por Dirección.' });

    const base = {
      tipo: 'bounty',
      nombre,
      dni,
      torneoId: torneo._id,
      torneo: torneo.nombre,
      fecha: diaOperativo(),
      hora: nowTimeStr(),
      cajero: String(req.user.username || body.cajero || '').trim()
    };

    const pagos = await Pago.insertMany(montos.map(monto => ({ ...base, monto })));
    res.status(201).json(pagos);
  } catch (err) {
    console.error('Error registrando pago de bounty:', err);
    res.status(500).json({ error: 'Error al registrar el pago del bounty.' });
  }
});

module.exports = router;
