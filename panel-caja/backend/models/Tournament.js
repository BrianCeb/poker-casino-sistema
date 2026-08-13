const mongoose = require('mongoose');

// Guardamos un unico documento "activo" que representa el torneo del dia.
// Si en el futuro necesitan varios torneos en simultaneo, se le agrega
// un campo "activo: Boolean" y se filtra por eso en vez de tomar el ultimo.
const tournamentSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  buyIn: { type: Number, required: true, min: 0 },
  recompra: { type: Number, required: true, min: 0 },
  fecha: { type: String, required: true } // YYYY-MM-DD
}, { timestamps: true });

module.exports = mongoose.model('Tournament', tournamentSchema);
