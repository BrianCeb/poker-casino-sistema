const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  dni: { type: String, required: true, index: true },
  nombre: { type: String, required: true },
  apellido: { type: String, required: true },
  tipo: { type: String, enum: ['buyin', 'recompra'], required: true },
  monto: { type: Number, required: true, min: 0 },
  torneo: { type: String, required: true },
  fecha: { type: String, required: true, index: true }, // YYYY-MM-DD, para filtrar "hoy"
  hora: { type: String, required: true },
  cajero: { type: String, default: '' }
}, { timestamps: true });

// Indice compuesto: consultas por dni + fecha son las mas frecuentes (panel Caja)
transactionSchema.index({ fecha: 1, dni: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
