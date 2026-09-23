// ======================================================
// PLANTILLAS INICIALES DE ESTRUCTURA DE CIEGAS
// ======================================================
// Se cargan en la base una sola vez (si no existe una plantilla con ese
// nombre). Despues se editan desde Direccion; cambiar este archivo NO
// pisa una plantilla ya creada.
// ======================================================

const n = (sb, bb, ante, minutos = 20) => ({ tipo: 'nivel', sb, bb, ante, minutos });
const descanso = (minutos) => ({ tipo: 'descanso', minutos });

const PLANTILLAS_INICIALES = [
  {
    // Fuente: tournament-structure_3.pdf, con correcciones confirmadas
    // por Direccion: nivel 8 = 600/1.200/1.200 y nivel 21 ante 40K.
    // Nivel 18 (10K/15K/15K) queda tal cual el PDF.
    nombre: 'Funny Sundays',
    cierreRegistroNivel: 10, // Re-Entry hasta el final del nivel 10
    niveles: [
      n(100, 200, 200),              // 1
      n(200, 300, 300),              // 2
      n(200, 400, 400),              // 3
      n(300, 500, 500),              // 4
      n(300, 600, 600),              // 5
      descanso(15),
      n(400, 800, 800),              // 6
      n(500, 1000, 1000),            // 7
      n(600, 1200, 1200),            // 8
      n(1000, 1500, 1500),           // 9
      n(1000, 2000, 2000),           // 10
      descanso(15),
      n(1500, 3000, 3000),           // 11
      n(2000, 4000, 4000),           // 12
      n(2500, 5000, 5000),           // 13
      n(3000, 6000, 6000),           // 14
      n(4000, 8000, 8000),           // 15
      descanso(30),
      n(5000, 10000, 10000),         // 16
      n(6000, 12000, 12000),         // 17
      n(10000, 15000, 15000),        // 18
      n(10000, 20000, 20000),        // 19
      n(15000, 30000, 30000),        // 20
      n(20000, 40000, 40000),        // 21
      n(25000, 50000, 50000),        // 22
      n(30000, 60000, 60000),        // 23
      descanso(15),
      n(40000, 80000, 80000),        // 24
      n(50000, 100000, 100000),      // 25
      n(75000, 150000, 150000),      // 26
      n(100000, 200000, 200000),     // 27
      n(150000, 300000, 300000),     // 28
      n(200000, 400000, 400000),     // 29
      n(250000, 500000, 500000),     // 30
      n(300000, 600000, 600000),     // 31
      descanso(15)
    ]
  }
];

module.exports = { PLANTILLAS_INICIALES };