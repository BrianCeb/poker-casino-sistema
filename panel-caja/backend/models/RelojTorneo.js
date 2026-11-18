const mongoose = require('mongoose');

// ======================================================
// RELOJ DEL TORNEO (solo lectura desde Caja)
// ======================================================
// El modelo completo vive en panel-direccion/backend/models/RelojTorneo.js
// y es Direccion quien lo crea y lo edita. Caja solo lo LEE para saber
// como se reparte el pozo (porcentaje que cobra, redondeo y tabla de
// premios personalizada), asi paga exactamente lo mismo que muestra la
// pantalla del reloj.
//
// Se declaran solo los campos que usa Caja; "strict: false" deja pasar
// el resto tal cual esta guardado. Caja NUNCA guarda en esta coleccion.
// ======================================================

const relojTorneoSchema = new mongoose.Schema({
  torneoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', index: true },
  porcentajePagados: { type: Number },
  redondeoPremios: { type: Number },
  premios: { type: Array }
}, { strict: false, collection: 'relojtorneos' });

module.exports = mongoose.model('RelojTorneo', relojTorneoSchema);
