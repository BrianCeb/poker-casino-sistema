const mongoose = require('mongoose');
const transactionSchema = new mongoose.Schema({
  dni: { type: String, required: true, index: true },
  nombre: { type: String, required: true },
  apellido: { type: String, required: true },
  tipo: { type: String, enum: ['buyin', 'recompra'], required: true },
  monto: { type: Number, required: true, min: 0 },
  torneoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: false, index: true },
  torneo: { type: String, required: true },
  fecha: { type: String, required: true, index: true },
  hora: { type: String, required: true },
  cajero: { type: String, default: '' },
  // Anulacion: no se borra el registro, queda como historial pero no
  // cuenta en los totales ni bloquea un nuevo buy-in del mismo dia.
  anulado: { type: Boolean, default: false },
  anuladoPor: { type: String, default: '' },
  anuladoEn: { type: Date, default: null }
}, { timestamps: true });

transactionSchema.index({ fecha: 1, dni: 1 });
// Garantiza a nivel de MongoDB un solo buy-in ACTIVO por jugador y fecha.
// Si el buy-in se anula, anulado:true saca ese documento del indice y
// libera el lugar para que se pueda cargar un buy-in nuevo ese mismo dia.
transactionSchema.index(
  { fecha: 1, dni: 1, tipo: 1 },
  { unique: true, partialFilterExpression: { tipo: 'buyin', anulado: false }, name: 'unique_buyin_por_jugador_fecha' }
);
module.exports = mongoose.model('Transaction', transactionSchema);