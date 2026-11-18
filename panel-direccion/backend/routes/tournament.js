const express = require('express');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Tournament = require('../models/Tournament');
const Transaction = require('../models/Transaction');
const Pago = require('../models/Pago');
const RelojTorneo = require('../models/RelojTorneo');
const RelojPrueba = require('../models/RelojPrueba');
const { requireAuth, requireRole } = require('../middleware/auth');
const { diaOperativo } = require('../utils/diaOperativo');

const router = express.Router();


// ======================================================
// OBTENER TORNEO ACTIVO
// ======================================================

router.get('/', requireAuth, async (req, res) => {
  try {
    const activo = await Tournament
      .findOne({ activo: true })
      .sort({ createdAt: -1 });

    if (!activo) {
      return res.json({
        nombre: 'Sin configurar',
        buyIn: 0,
        recompra: 0,
        rake: 0,
        tipo: 'normal',
        mbRake: 0,
        mbBounty: 0,
        hunterAporte: 0,
        fecha: diaOperativo(),
        activo: false
      });
    }

    res.json(activo);

  } catch (err) {
    console.error('Error obteniendo torneo:', err);

    res.status(500).json({
      error: 'Error al obtener el torneo.'
    });
  }
});


// ======================================================
// HISTORIAL DE TORNEOS (para el selector de Direccion)
// ======================================================

router.get('/historial', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    const torneos = await Tournament
      .find({})
      .sort({ fecha: -1, createdAt: -1 })
      .select('nombre fecha buyIn recompra rake tipo mbRake mbBounty hunterAporte activo')
      .lean();

    res.json(torneos);

  } catch (err) {
    console.error('Error obteniendo historial de torneos:', err);

    res.status(500).json({
      error: 'Error al obtener el historial de torneos.'
    });
  }
});


// ======================================================
// CREAR / ACTIVAR TORNEO
// ======================================================

router.post('/', requireAuth, requireRole('direccion'), async (req, res) => {
  try {

    const {
      nombre,
      buyIn,
      recompra,
      rake,
      fecha,
      tipo,
      mbRake,
      mbBounty,
      hunterAporte
    } = req.body || {};

    // Si no mandan fecha, usamos el dia operativo (no medianoche calendario)
    // asi un torneo cargado a las 2 AM se atribuye al dia que realmente
    // corresponde en la operatoria del casino - y coincide con la fecha
    // que van a tener las transacciones que se carguen esa madrugada.
    const torneoFecha = fecha || diaOperativo();

    // 'mistery_bounty' es el unico tipo especial soportado; cualquier otra
    // cosa (o nada) se trata como torneo 'normal', que es el comportamiento
    // de siempre.
    const tipoTorneo = tipo === 'mistery_bounty' ? 'mistery_bounty' : 'normal';

    if (
      !nombre ||
      buyIn == null ||
      recompra == null
    ) {
      return res.status(400).json({
        error: 'Nombre, buy-in y recompra son obligatorios.'
      });
    }

    const buyInNum = Number(buyIn);
    const recompraNum = Number(recompra);

    if (
      !Number.isFinite(buyInNum) ||
      !Number.isFinite(recompraNum)
    ) {
      return res.status(400).json({
        error: 'Los montos deben ser números válidos.'
      });
    }

    if (
      buyInNum < 0 ||
      recompraNum < 0
    ) {
      return res.status(400).json({
        error: 'Los montos no pueden ser negativos.'
      });
    }

    let rakeNum;
    let mbRakeNum = 0;
    let mbBountyNum = 0;
    let hunterNum = 0;

    if (tipoTorneo === 'mistery_bounty') {

      // Mistery Bounty: el buy-in (y la recompra, con el mismo monto fijo)
      // se dividen en Rake + Bounty + Prizepool. Rake y Bounty son montos
      // fijos en dinero (no porcentajes), y valen lo mismo para buy-in y
      // para recompra.

      if (mbRake == null || mbBounty == null) {
        return res.status(400).json({
          error: 'Para Mistery Bounty, Rake y Bounty son obligatorios.'
        });
      }

      mbRakeNum = Number(mbRake);
      mbBountyNum = Number(mbBounty);

      if (
        !Number.isFinite(mbRakeNum) ||
        !Number.isFinite(mbBountyNum)
      ) {
        return res.status(400).json({
          error: 'Rake y Bounty deben ser números válidos.'
        });
      }

      if (
        mbRakeNum < 0 ||
        mbBountyNum < 0
      ) {
        return res.status(400).json({
          error: 'Rake y Bounty no pueden ser negativos.'
        });
      }

      // Hunter: monto fijo por operacion que sale de lo que iba al pozo.
      // Si no lo mandan, se usa el valor por defecto de la casa ($1.500).
      hunterNum = hunterAporte == null || hunterAporte === '' ? 1500 : Number(hunterAporte);

      if (!Number.isFinite(hunterNum) || hunterNum < 0) {
        return res.status(400).json({
          error: 'El aporte al Hunter debe ser un número válido, mayor o igual a 0.'
        });
      }

      const descuentos = mbRakeNum + mbBountyNum + hunterNum;

      if (descuentos > buyInNum) {
        return res.status(400).json({
          error: 'La suma de Rake, Bounty y Hunter no puede superar el buy-in.'
        });
      }

      if (recompraNum > 0 && descuentos > recompraNum) {
        return res.status(400).json({
          error: 'La suma de Rake, Bounty y Hunter no puede superar el monto de la recompra.'
        });
      }

      // El campo general "rake" queda igual al rake fijo del Mistery Bounty,
      // para que cualquier pantalla vieja que todavia lea "rake" (por ej.
      // el historial) muestre un numero coherente.
      rakeNum = mbRakeNum;

    } else {

      if (rake == null) {
        return res.status(400).json({
          error: 'Nombre, buy-in, recompra y rake son obligatorios.'
        });
      }

      rakeNum = Number(rake);

      if (!Number.isFinite(rakeNum)) {
        return res.status(400).json({
          error: 'Los montos deben ser números válidos.'
        });
      }

      if (rakeNum < 0) {
        return res.status(400).json({
          error: 'Los montos no pueden ser negativos.'
        });
      }

      if (rakeNum > buyInNum) {
        return res.status(400).json({
          error: 'El rake no puede ser mayor que el buy-in.'
        });
      }

      if (recompraNum > 0 && rakeNum > recompraNum) {
        return res.status(400).json({
          error: 'El rake no puede ser mayor que el monto de la recompra.'
        });
      }
    }

    await Tournament.updateMany(
      { activo: true },
      { $set: { activo: false } }
    );

    const nuevo = await Tournament.create({
      nombre: String(nombre).trim(),
      buyIn: buyInNum,
      recompra: recompraNum,
      rake: rakeNum,
      tipo: tipoTorneo,
      mbRake: mbRakeNum,
      mbBounty: mbBountyNum,
      hunterAporte: hunterNum,
      fecha: torneoFecha,
      activo: true
    });

    res.status(201).json(nuevo);

  } catch (err) {

    console.error('Error guardando torneo:', err);

    res.status(500).json({
      error: 'Error al guardar el torneo.'
    });
  }
});


// ======================================================
// BORRAR TORNEO (pensado para torneos de PRUEBA)
// ======================================================
// Hace lo mismo que el script borrar-torneo-prueba.js, pero desde el
// panel y con mas cuidado:
//  - Borra el torneo, sus operaciones (Buy-in / Re-Entry), sus pagos
//    (premios, bounties, Hunter), su reloj y la copia de prueba del reloj.
//  - Las operaciones se buscan por torneoId. Las viejas sin torneoId solo
//    si coinciden nombre Y fecha (nunca solo por nombre: "Funny Sundays"
//    se repite todas las semanas).
//  - NUNCA toca jugadores ni otros torneos.
//  - Antes de borrar guarda TODO en un archivo JSON dentro de
//    BACKUP_DIR/torneos-borrados/. Si no puede guardarlo, no borra nada.
//  - Para confirmar hay que escribir el nombre exacto del torneo.
// ======================================================

function filtroOperaciones(torneo) {
  return {
    $or: [
      { torneoId: torneo._id },
      { torneoId: null, torneo: torneo.nombre, fecha: torneo.fecha }
    ]
  };
}

async function datosDelTorneo(torneo) {
  const [operaciones, pagos, reloj, relojPrueba] = await Promise.all([
    Transaction.find(filtroOperaciones(torneo)).lean(),
    Pago.find({ torneoId: torneo._id }).lean(),
    RelojTorneo.findOne({ torneoId: torneo._id }).lean(),
    RelojPrueba.findOne({ torneoId: torneo._id }).lean()
  ]);
  return { operaciones, pagos, reloj, relojPrueba };
}

function idValido(id) {
  return mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id;
}


// GET /api/tournament/:id/borrado -> lo que se borraria (no borra nada).
router.get('/:id/borrado', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    if (!idValido(req.params.id)) return res.status(400).json({ error: 'Torneo inválido.' });
    const torneo = await Tournament.findById(req.params.id).lean();
    if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });

    const d = await datosDelTorneo(torneo);
    const activas = d.operaciones.filter(t => !t.anulado);

    res.json({
      torneo: { id: torneo._id, nombre: torneo.nombre, fecha: torneo.fecha, activo: !!torneo.activo },
      operaciones: {
        total: d.operaciones.length,
        activas: activas.length,
        anuladas: d.operaciones.length - activas.length,
        recaudado: activas.reduce((s, t) => s + Number(t.monto || 0), 0),
        jugadores: new Set(d.operaciones.map(t => t.dni)).size
      },
      pagos: {
        total: d.pagos.length,
        monto: d.pagos.filter(p => !p.anulado).reduce((s, p) => s + Number(p.monto || 0), 0)
      },
      reloj: !!d.reloj,
      relojPrueba: !!d.relojPrueba
    });
  } catch (err) {
    console.error('Error armando vista previa de borrado:', err);
    res.status(500).json({ error: 'Error al revisar el torneo.' });
  }
});


// DELETE /api/tournament/:id  { confirmacion: "<nombre exacto>" }
router.delete('/:id', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    if (!idValido(req.params.id)) return res.status(400).json({ error: 'Torneo inválido.' });
    const torneo = await Tournament.findById(req.params.id).lean();
    if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });

    const confirmacion = String((req.body || {}).confirmacion || '').trim();
    if (confirmacion !== String(torneo.nombre).trim()) {
      return res.status(400).json({ error: 'Para borrar tenés que escribir el nombre exacto del torneo.' });
    }

    const d = await datosDelTorneo(torneo);
    const usuario = req.user.username || req.user.sub;

    // 1) Respaldo. Si falla, no se borra nada.
    let archivo;
    try {
      const dir = path.join(process.env.BACKUP_DIR || './backups', 'torneos-borrados');
      fs.mkdirSync(dir, { recursive: true });
      const slug = String(torneo.nombre).normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      archivo = path.join(dir, `${torneo.fecha}_${slug}_${torneo._id}.json`);
      fs.writeFileSync(archivo, JSON.stringify({
        borradoPor: usuario,
        borradoEn: new Date().toISOString(),
        torneo,
        ...d
      }, null, 2));
    } catch (err) {
      console.error('No se pudo guardar el respaldo del torneo a borrar:', err);
      return res.status(500).json({ error: 'No se pudo guardar el respaldo del torneo, así que no se borró nada.' });
    }

    // 2) Borrado.
    const [ops, pagos, reloj, relojPrueba, t] = await Promise.all([
      Transaction.deleteMany(filtroOperaciones(torneo)),
      Pago.deleteMany({ torneoId: torneo._id }),
      RelojTorneo.deleteMany({ torneoId: torneo._id }),
      RelojPrueba.deleteMany({ torneoId: torneo._id }),
      Tournament.deleteOne({ _id: torneo._id })
    ]);

    console.log(`Torneo borrado por ${usuario}: "${torneo.nombre}" (${torneo.fecha}) — respaldo en ${archivo}`);

    res.json({
      ok: true,
      borrados: {
        operaciones: ops.deletedCount,
        pagos: pagos.deletedCount,
        reloj: reloj.deletedCount + relojPrueba.deletedCount,
        torneo: t.deletedCount
      },
      respaldo: path.basename(archivo),
      eraActivo: !!torneo.activo
    });
  } catch (err) {
    console.error('Error borrando torneo:', err);
    res.status(500).json({ error: 'Error al borrar el torneo.' });
  }
});

module.exports = router;