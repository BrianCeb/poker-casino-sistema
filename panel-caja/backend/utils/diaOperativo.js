// El "dia operativo" del casino no cambia a medianoche (00:00) sino a
// las 6 AM. Esto evita el bug donde un torneo que sigue jugandose
// despues de medianoche "desaparece" del control del dia porque el
// calendario ya cambio de fecha.
//
// Ejemplo: un torneo arranca 22/08 22:00 y termina 23/08 03:00.
// Con el corte a las 6 AM, TODO ese torneo pertenece al dia operativo
// "2026-08-22" - incluidas las operaciones hechas despues de medianoche.
//
// Si en algun momento cambian el horario tipico de cierre, ajustar
// solo esta constante.
const HORA_CORTE = 6;

function diaOperativo(fecha = new Date()) {
  const d = new Date(fecha);
  if (d.getHours() < HORA_CORTE) {
    d.setDate(d.getDate() - 1);
  }
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

module.exports = { diaOperativo, HORA_CORTE };