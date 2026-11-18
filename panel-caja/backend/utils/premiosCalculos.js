// ======================================================
// CALCULO DE PREMIOS (copia de panel-direccion)
// ======================================================
// Copia EXACTA de las funciones de premios y pozo de
// panel-direccion/backend/utils/relojCalculos.js, para que Caja pague
// los mismos montos que muestra el reloj. Caja es un servidor aparte y
// no puede importar archivos de Direccion.
//
// IMPORTANTE: si se cambia la formula de premios en relojCalculos.js,
// hay que copiar el cambio aca tambien.
// ======================================================


// Curva estandar de la casa: cada puesto pesa 1 / (puesto ^ 0.8). Se
// ajusto a la tabla que usaban (el 1ro cobra ~1,7 veces el 2do).
const PENDIENTE_CURVA = 0.8;

// Porcentajes automaticos para N puestos pagos, redondeados a 0,5% y
// con la diferencia del redondeo en el 1er puesto (siempre suman 100).
function porcentajesAutomaticos(puestos) {
  if (puestos <= 0) return [];
  const pesos = [];
  for (let i = 1; i <= puestos; i++) pesos.push(1 / Math.pow(i, PENDIENTE_CURVA));
  const suma = pesos.reduce((s, p) => s + p, 0);
  const pct = pesos.map(p => Math.round((p / suma) * 100 * 2) / 2);
  const diferencia = 100 - pct.reduce((s, p) => s + p, 0);
  pct[0] = Math.round((pct[0] + diferencia) * 10) / 10;
  return pct;
}

// Cuantos puestos pagan: porcentajePagados de los jugadores reales,
// redondeado hacia arriba. Nunca mas puestos que jugadores.
function puestosPagos(jugadores, porcentajePagados) {
  if (jugadores <= 0) return 0;
  const puestos = Math.ceil(jugadores * Number(porcentajePagados || 12.5) / 100 - 1e-9);
  return Math.min(jugadores, Math.max(1, puestos));
}

// Elige los porcentajes: tabla personalizada si hay un tramo que cubra
// esa cantidad de jugadores; si no, la tabla automatica.
function porcentajesPremios(jugadores, config) {
  const tramos = config.premios || [];
  const tramo = tramos.find(t =>
    jugadores >= t.desdeJugadores &&
    (t.hastaJugadores == null || jugadores <= t.hastaJugadores)
  );
  if (tramo) {
    return { origen: 'personalizada', porcentajes: tramo.porcentajes.slice(0, Math.max(1, jugadores)) };
  }
  return {
    origen: 'automatica',
    porcentajes: porcentajesAutomaticos(puestosPagos(jugadores, config.porcentajePagados))
  };
}

// Montos en pesos: cada premio redondeado al multiplo configurado, y la
// diferencia (sobrante o faltante) en el 1er puesto para que el total
// cierre exacto con el pozo.
function montosPremios(pozo, porcentajes, redondeo) {
  if (!porcentajes.length || pozo <= 0) {
    return porcentajes.map(pct => ({ porcentaje: pct, monto: 0 }));
  }
  const m = Number(redondeo || 0);
  const redondear = x => (m > 0 ? Math.round(x / m) * m : Math.round(x));
  const montos = porcentajes.map(pct => redondear(pozo * pct / 100));
  const diferencia = pozo - montos.reduce((s, x) => s + x, 0);
  montos[0] += diferencia;
  return porcentajes.map((pct, i) => ({ porcentaje: pct, monto: montos[i] }));
}


// POZO (mismo criterio que el Excel del dia y el reloj)
// Normal: pozo = recaudado - (operaciones x rake del torneo).
// Mistery Bounty: se suma el prizepool real guardado en cada transaccion
// (el bounty va aparte y no entra al pozo).
function calcularPozo(transaccionesActivas, torneo) {
  const recaudado = transaccionesActivas.reduce((s, t) => s + Number(t.monto || 0), 0);

  if (torneo && torneo.tipo === 'mistery_bounty') {
    let rake = 0;
    let bounty = 0;
    let hunter = 0;
    let prizepool = 0;
    for (const t of transaccionesActivas) {
      const d = t.desglose || {};
      rake += Number(d.rake || 0);
      bounty += Number(d.bounty || 0);
      hunter += Number(d.hunter || 0);
      prizepool += Number(d.prizepool || 0);
    }
    return { recaudado, rake, bounty, hunter, pozo: Math.max(0, prizepool) };
  }

  const rake = transaccionesActivas.length * Number((torneo && torneo.rake) || 0);
  return { recaudado, rake, bounty: 0, hunter: 0, pozo: Math.max(0, recaudado - rake) };
}


module.exports = {
  porcentajesAutomaticos,
  puestosPagos,
  porcentajesPremios,
  montosPremios,
  calcularPozo
};
