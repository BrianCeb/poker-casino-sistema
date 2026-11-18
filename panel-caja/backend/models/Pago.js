const mongoose = require('mongoose');

// ======================================================
// PAGO DE PREMIOS Y BOUNTIES (Caja)
// ======================================================
// Cada documento es UN ticket entregado al jugador para cobrar en caja:
//  - tipo 'premio': un puesto pago del torneo (1ro, 2do, ...). El monto
//    se calcula en el backend con la misma formula del reloj y queda
//    "fotografiado" en el momento del pago.
//  - tipo 'bounty': un bounty cobrado. Si el jugador cobra varios, se
//    guarda un documento (y se imprime un ticket) por cada uno. Siempre
//    con el DNI del jugador (se elige de los inscriptos del dia).
//  - tipo 'hunter': el premio Hunter (el que mas bounties cobro). Si hay
//    empate, un documento por cada ganador con su parte.
//
// ESTE ARCHIVO ES IGUAL EN panel-caja Y panel-direccion.
//
// Va en una coleccion aparte (y no en Transaction) para no alterar los
// totales del dia, el pozo, el Excel ni los reportes, que hoy cuentan
// solo cobros de Buy-in y Re-Entry.
//
// Igual que con las operaciones: no se borra. Solo Direccion podra
// anularlo (anulado: true) y en ese caso deja de contar y libera el
// puesto para volver a pagarlo.
// ======================================================

const pagoSchema = new mongoose.Schema({
  tipo: { type: String, enum: ['premio', 'bounty', 'hunter'], required: true },

  // Solo en premios: puesto que cobra (1 = primero).
  puesto: { type: Number, min: 1, default: null },

  monto: { type: Number, required: true, min: 0 },

  // Nombre tal cual lo dijo el jugador al cobrar. El DNI es opcional:
  // se completa solo si el nombre coincide con un jugador inscripto hoy.
  nombre: { type: String, required: true, trim: true },
  dni: { type: String, trim: true, default: '' },

  torneoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true, index: true },
  torneo: { type: String, required: true },
  fecha: { type: String, required: true, index: true },
  hora: { type: String, required: true },
  cajero: { type: String, default: '' },

  // Datos con los que se calculo el premio (para poder controlarlo
  // despues): pozo, jugadores reales y porcentaje del puesto.
  calculo: {
    pozo: { type: Number, default: 0 },
    jugadores: { type: Number, default: 0 },
    porcentaje: { type: Number, default: 0 }
  },

  anulado: { type: Boolean, default: false },
  anuladoPor: { type: String, default: '' },
  anuladoEn: { type: Date, default: null }
}, { timestamps: true });

// Un puesto se paga UNA sola vez por torneo (salvo que se anule).
pagoSchema.index(
  { torneoId: 1, puesto: 1 },
  { unique: true, partialFilterExpression: { tipo: 'premio', anulado: false }, name: 'unique_premio_por_puesto_torneo' }
);

// El Hunter se paga UNA sola vez por jugador y torneo.
pagoSchema.index(
  { torneoId: 1, dni: 1 },
  { unique: true, partialFilterExpression: { tipo: 'hunter', anulado: false }, name: 'unique_hunter_por_jugador_torneo' }
);

module.exports = mongoose.model('Pago', pagoSchema);
