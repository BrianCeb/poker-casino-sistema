const mongoose = require('mongoose');

// ======================================================
// PLANTILLAS DE TABLA DE PREMIOS
// ======================================================
// Tablas de pago guardadas con nombre ("Tabla Funny Sundays",
// "Tabla Bounty", etc.). Al aplicar una a un torneo, los tramos se
// COPIAN a RelojTorneo.premios: editar la plantilla despues no cambia
// torneos ya configurados, y editar la tabla de un torneo no cambia la
// plantilla.
//
// "Formula automatica" no es una plantilla: es simplemente no tener
// tabla (premios vacio).
// ======================================================

// Mismo formato que los tramos de RelojTorneo.premios.
const tramoSchema = new mongoose.Schema({
  desdeJugadores: { type: Number, required: true, min: 1 },
  hastaJugadores: { type: Number, min: 1, default: null },
  porcentajes: { type: [Number], required: true }
}, { _id: false });

const plantillaPremiosSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true, unique: true },
  premios: { type: [tramoSchema], default: [] },
  // Igual que el resto del sistema: no se borra, se desactiva.
  activo: { type: Boolean, default: true, index: true }
}, { timestamps: true });

module.exports = mongoose.model('PlantillaPremios', plantillaPremiosSchema);