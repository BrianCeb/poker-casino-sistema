const mongoose = require('mongoose');

// Historial de cada bloque de trabajo o descanso. Se cierra (se le pone
// "fin") cada vez que el pagador cambia de estado. Sirve para el
// tablero en vivo, y a futuro para un reporte de horas trabajadas.
const turnoPagadorSchema = new mongoose.Schema({
    pagadorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pagador', required: true, index: true },
    nombre: { type: String, required: true },
    estado: { type: String, enum: ['en_mesa', 'en_descanso'], required: true },
    mesa: { type: Number, default: null },
    inicio: { type: Date, required: true },
    fin: { type: Date, default: null },
    duracionMinutos: { type: Number, default: null }
}, { timestamps: true });

module.exports = mongoose.model('TurnoPagador', turnoPagadorSchema);