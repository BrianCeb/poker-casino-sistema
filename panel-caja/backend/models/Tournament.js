const mongoose = require('mongoose');
const tournamentSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  buyIn: { type: Number, required: true, min: 0 },
  recompra: { type: Number, required: true, min: 0 },
  tipo: { type: String, enum: ['normal', 'mistery_bounty'], default: 'normal' },
  mbRake: { type: Number, min: 0, default: 0 },
  mbBounty: { type: Number, min: 0, default: 0 },
  // Hunter: monto fijo por operacion que sale del pozo (lo configura
  // Direccion). hunterHabilitado lo maneja Direccion; Caja solo lo lee.
  hunterAporte: { type: Number, min: 0, default: 0 },
  hunterHabilitado: { type: Boolean, default: false },
  fecha: { type: String, required: true, index: true },
  activo: { type: Boolean, default: true, index: true }
}, { timestamps: true });

tournamentSchema.index({ fecha: 1, activo: 1 });
module.exports = mongoose.model('Tournament', tournamentSchema);