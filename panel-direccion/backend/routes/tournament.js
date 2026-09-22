const express = require('express');
const Tournament = require('../models/Tournament');
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
      .select('nombre fecha buyIn recompra rake tipo mbRake mbBounty activo')
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
      mbBounty
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

      if (mbRakeNum + mbBountyNum > buyInNum) {
        return res.status(400).json({
          error: 'La suma de Rake y Bounty no puede superar el buy-in.'
        });
      }

      if (recompraNum > 0 && (mbRakeNum + mbBountyNum) > recompraNum) {
        return res.status(400).json({
          error: 'La suma de Rake y Bounty no puede superar el monto de la recompra.'
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


module.exports = router;