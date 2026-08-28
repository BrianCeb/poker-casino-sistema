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
  cajero: { type: String, default: '' }
}, { timestamps: true });

transactionSchema.index({ fecha: 1, dni: 1 });
// Garantiza a nivel de MongoDB un solo buy-in por jugador y fecha.
transactionSchema.index(
  { fecha: 1, dni: 1, tipo: 1 },
  { unique: true, partialFilterExpression: { tipo: 'buyin' }, name: 'unique_buyin_por_jugador_fecha' }
);
module.exports = mongoose.model('Transaction', transactionSchema);
