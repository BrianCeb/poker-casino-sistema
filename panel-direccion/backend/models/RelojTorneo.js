const mongoose = require('mongoose');

// ======================================================
// RELOJ DEL TORNEO
// ======================================================
// Un documento por torneo (vinculado por torneoId). Guarda:
//  - la CONFIGURACION: estructura de niveles, stacks, re-entradas,
//    cierre de registro y tabla de premios por field.
//  - el ESTADO del reloj: en que nivel va, si esta corriendo o
//    pausado, y desde cuando.
//
// El tiempo NO se descuenta en el navegador ni se guarda segundo a
// segundo: se guarda cuando arranco (o se reanudo) el nivel actual
// y cuantos segundos ya se habian consumido antes de la ultima pausa.
// Cada pantalla calcula el tiempo restante con eso, asi que todas
// muestran lo mismo aunque se recarguen o se abran en otra PC.
//
// Se usa un modelo aparte (y no campos nuevos en Tournament) para no
// tener que tocar el Tournament.js de Caja ni nada de lo que hoy
// funciona con torneos (cobros, reportes, Excel).
// ======================================================


// Un nivel de ciegas o un descanso dentro de la estructura.
const nivelSchema = new mongoose.Schema({
  tipo: { type: String, enum: ['nivel', 'descanso'], default: 'nivel' },
  sb: { type: Number, min: 0, default: 0 },
  bb: { type: Number, min: 0, default: 0 },
  ante: { type: Number, min: 0, default: 0 },
  minutos: { type: Number, required: true, min: 1 }
}, { _id: false });


// Un tramo de la tabla de premios PERSONALIZADA. Ejemplo:
//   { desdeJugadores: 9,  hastaJugadores: 16,   porcentajes: [63.5, 36.5] }
//   { desdeJugadores: 17, hastaJugadores: 24,   porcentajes: [50, 29, 21] }
//   { desdeJugadores: 25, hastaJugadores: null, porcentajes: [...] }  // sin tope
// "Jugadores" = jugadores REALES del torneo = cantidad de buy-ins (hay un
// solo buy-in activo por jugador y dia). Las re-entradas NO cuentan para
// definir cuantos cobran; si suman al pozo. Los porcentajes van en orden
// de puesto (1ro, 2do, 3ro...) y deben sumar 100.
//
// Si el torneo NO tiene tabla personalizada (premios vacio), o si los
// jugadores superan el ultimo tramo cargado, el backend usa la tabla
// automatica: cobra el porcentajePagados de los jugadores reales,
// redondeado hacia arriba (12,5% => un puesto pago mas cada 8
// jugadores), con la curva estandar de la casa. No tiene tope.
const tramoPremiosSchema = new mongoose.Schema({
  desdeJugadores: { type: Number, required: true, min: 1 },
  hastaJugadores: { type: Number, min: 1, default: null },
  porcentajes: { type: [Number], required: true }
}, { _id: false });


const relojTorneoSchema = new mongoose.Schema({

  torneoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tournament',
    required: true,
    unique: true,
    index: true
  },

  // ---------------- CONFIGURACION ----------------

  stackInicial: { type: Number, min: 0, default: 0 },

  // Fichas que recibe cada re-entry. Normalmente es igual al stack
  // inicial, pero queda separado por si algun torneo lo cambia.
  stackReentry: { type: Number, min: 0, default: 0 },

  reentradasIlimitadas: { type: Boolean, default: true },

  // Maximo de re-entradas POR JUGADOR. Solo se usa si
  // reentradasIlimitadas es false.
  maxReentradas: { type: Number, min: 0, default: 0 },

  // El registro cierra al FINAL de este nivel. Se cuenta solo niveles
  // de juego (los descansos no suman), empezando en 1, igual que el
  // numero de nivel que se ve en pantalla. 0 = sin definir.
  cierreRegistroNivel: { type: Number, min: 0, default: 0 },

  niveles: { type: [nivelSchema], default: [] },

  // Porcentaje de los jugadores reales (buy-ins, sin re-entradas) que
  // cobra. Se redondea hacia arriba.
  porcentajePagados: { type: Number, min: 1, max: 100, default: 12.5 },

  // Cada premio se redondea a este multiplo; lo que sobra o falta por
  // el redondeo se ajusta en el 1er puesto para que el total cierre
  // exacto con el pozo. 0 = sin redondeo.
  redondeoPremios: { type: Number, min: 0, default: 1000 },

  // Tabla personalizada (opcional). Vacia = tabla automatica.
  premios: { type: [tramoPremiosSchema], default: [] },

  // Nombre de la plantilla de premios aplicada (solo informativo, para
  // mostrar cual esta en uso). Se vacia si la tabla se edita a mano.
  premiosPlantilla: { type: String, default: '' },

  // Jugadores que juegan la mesa final. La "burbuja de mesa final" se
  // muestra cuando quedan estos + 1. 0 = sin burbuja de mesa final.
  jugadoresMesaFinal: { type: Number, min: 0, default: 8 },

  // ---------------- DATOS EN VIVO ----------------

  // Eliminaciones DEFINITIVAS: Direccion suma 1 solo cuando el jugador
  // se va del torneo y ya no hace re-entry (en general, despues del
  // cierre del registro). Una re-entrada no cuenta como eliminacion.
  // Como hay un solo buy-in activo por jugador y dia, la cantidad de
  // buy-ins es la cantidad de jugadores distintos, entonces:
  //   jugadores restantes = buy-ins - eliminaciones
  eliminaciones: { type: Number, min: 0, default: 0 },

  // Fichas renunciadas (surrender): cada carga del supervisor por
  // separado, para poder deshacer la ultima. Se descuentan de las
  // fichas totales (y por lo tanto del stack promedio).
  renuncias: {
    type: [{
      cantidad: { type: Number, min: 1, required: true },
      en: { type: Date, default: Date.now }
    }],
    default: []
  },

  // ---------------- MODO PRUEBA ----------------
  // En el reloj REAL solo se usa "activa": indica que Direccion esta
  // trabajando sobre la copia de prueba (modelo RelojPrueba, mismo
  // esquema). En la COPIA de prueba, buyins y reentradas son las
  // cantidades ficticias. No se crean transacciones: los reportes, el
  // control del dia y el Excel no se enteran.
  prueba: {
    activa: { type: Boolean, default: false },
    buyins: { type: Number, min: 0, default: 0 },
    reentradas: { type: Number, min: 0, default: 0 },
    // Sin uso desde que la prueba es una copia aparte (las eliminaciones
    // de prueba son las "eliminaciones" de la copia). Queda por
    // compatibilidad con documentos ya guardados.
    eliminaciones: { type: Number, min: 0, default: 0 }
  },

  // Solo en la COPIA de prueba: tipo de torneo y montos para simular
  // (normal / Mistery Bounty) sin tocar el torneo real. Con usar=false
  // se usan los datos del torneo activo.
  torneoPrueba: {
    usar: { type: Boolean, default: false },
    tipo: { type: String, enum: ['normal', 'mistery_bounty'], default: 'normal' },
    buyIn: { type: Number, min: 0, default: 0 },
    recompra: { type: Number, min: 0, default: 0 },
    rake: { type: Number, min: 0, default: 0 },
    mbRake: { type: Number, min: 0, default: 0 },
    mbBounty: { type: Number, min: 0, default: 0 }
  },

  // ---------------- ESTADO DEL RELOJ ----------------

  estado: {
    type: String,
    enum: ['detenido', 'corriendo', 'pausado', 'finalizado'],
    default: 'detenido'
  },

  // Indice dentro de "niveles" (incluye descansos), empezando en 0.
  nivelActual: { type: Number, min: 0, default: 0 },

  // Momento en que arranco o se reanudo el nivel actual. Solo tiene
  // valor mientras el reloj esta corriendo.
  inicioNivel: { type: Date, default: null },

  // Segundos del nivel actual ya consumidos antes de la ultima pausa.
  segundosConsumidos: { type: Number, min: 0, default: 0 }

}, { timestamps: true });

module.exports = mongoose.model('RelojTorneo', relojTorneoSchema);