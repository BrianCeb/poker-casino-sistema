// ======================================================
// CALCULOS DEL RELOJ DEL TORNEO
// ======================================================
// Funciones puras (no tocan la base): reciben datos y devuelven
// resultados. Las usa routes/reloj.js. Estan separadas para poder
// probarlas sin MongoDB y para que la logica no quede mezclada con las
// rutas.
// ======================================================


// ------------------------------------------------------
// ESTRUCTURA DE NIVELES
// ------------------------------------------------------

// Devuelve la entrada de la estructura en la posicion i. Si el torneo
// sigue despues del final de la estructura, se repite el ultimo nivel de
// juego (mismas ciegas y duracion) indefinidamente.
function entradaEn(niveles, i) {
  if (i < niveles.length) return niveles[i];
  const ultimoJuego = [...niveles].reverse().find(n => n.tipo !== 'descanso');
  if (!ultimoJuego) return null;
  // Se copian los campos uno por uno (y no con "...") para que funcione
  // igual con objetos planos y con subdocumentos de Mongoose.
  return {
    tipo: 'nivel',
    sb: ultimoJuego.sb,
    bb: ultimoJuego.bb,
    ante: ultimoJuego.ante,
    minutos: ultimoJuego.minutos,
    extra: true
  };
}

function segundosDe(entrada) {
  return Math.round(Number(entrada.minutos || 0) * 60);
}

// Numero de nivel que se ve en pantalla (1, 2, 3...). Los descansos no
// suman. Si la posicion es un descanso, devuelve el numero del ultimo
// nivel jugado antes del descanso.
function numeroDeNivel(niveles, i) {
  let num = 0;
  const hasta = Math.min(i, niveles.length - 1);
  for (let k = 0; k <= hasta; k++) {
    if (niveles[k].tipo !== 'descanso') num++;
  }
  if (i >= niveles.length) num += i - niveles.length + 1;
  return num;
}

// Posicion en la estructura del nivel de juego numero N (1 = primero).
// Si N supera la estructura, devuelve la posicion "virtual" equivalente.
function posicionDelNivel(niveles, numero) {
  let num = 0;
  for (let k = 0; k < niveles.length; k++) {
    if (niveles[k].tipo !== 'descanso') {
      num++;
      if (num === numero) return k;
    }
  }
  return niveles.length - 1 + (numero - num);
}


// ------------------------------------------------------
// ESTADO DEL RELOJ EN UN MOMENTO DADO
// ------------------------------------------------------

// A partir de lo guardado en RelojTorneo, calcula en que nivel esta
// realmente el reloj ahora y cuantos segundos van de ese nivel. Si el
// reloj esta corriendo y ya termino uno o mas niveles, avanza solo.
function estadoEfectivo(reloj, ahora = new Date()) {
  const niveles = reloj.niveles || [];
  let indice = Number(reloj.nivelActual || 0);
  let transcurridos = Number(reloj.segundosConsumidos || 0);

  if (reloj.estado === 'corriendo' && reloj.inicioNivel) {
    transcurridos += Math.max(0, (ahora - new Date(reloj.inicioNivel)) / 1000);
  }

  if (!niveles.length) {
    return { indice: 0, transcurridos: 0, restantes: 0 };
  }

  // Avance automatico al terminar cada nivel.
  let entrada = entradaEn(niveles, indice);
  while (entrada && transcurridos >= segundosDe(entrada)) {
    transcurridos -= segundosDe(entrada);
    indice++;
    entrada = entradaEn(niveles, indice);
  }

  return {
    indice,
    transcurridos,
    restantes: entrada ? Math.max(0, segundosDe(entrada) - transcurridos) : 0
  };
}


// ------------------------------------------------------
// PREMIOS
// ------------------------------------------------------

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

// Tabla automatica completa, en tramos de jugadores (para mostrarla en
// el editor o usarla de base para una tabla personalizada). Cada tramo
// es un rango donde cobra la misma cantidad de puestos.
function tablaAutomatica(porcentajePagados = 12.5, hastaJugadores = 200) {
  const tramos = [];
  let desde = 1;
  let puestos = puestosPagos(1, porcentajePagados);
  for (let j = 2; j <= hastaJugadores + 1; j++) {
    const p = j <= hastaJugadores ? puestosPagos(j, porcentajePagados) : -1;
    if (p !== puestos) {
      tramos.push({ desdeJugadores: desde, hastaJugadores: j - 1, porcentajes: porcentajesAutomaticos(puestos) });
      desde = j;
      puestos = p;
    }
  }
  return tramos;
}

// Operaciones ficticias para el modo prueba: mismas cantidades y montos
// que cobraria Caja con la configuracion del torneo (incluido el
// desglose de Mistery Bounty), sin guardar nada en la base.
function transaccionesDePrueba(torneo, prueba) {
  const armar = (tipo, monto) => {
    const t = { tipo, monto, desglose: { rake: 0, bounty: 0, prizepool: 0 } };
    if (torneo.tipo === 'mistery_bounty') {
      const rake = Number(torneo.mbRake || 0);
      const bounty = Number(torneo.mbBounty || 0);
      t.desglose = { rake, bounty, prizepool: monto - rake - bounty };
    }
    return t;
  };
  const lista = [];
  for (let i = 0; i < Number(prueba.buyins || 0); i++) lista.push(armar('buyin', Number(torneo.buyIn || 0)));
  for (let i = 0; i < Number(prueba.reentradas || 0); i++) lista.push(armar('recompra', Number(torneo.recompra || 0)));
  return lista;
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


// ------------------------------------------------------
// POZO (mismo criterio que el Excel del dia)
// ------------------------------------------------------
// Normal: pozo = recaudado - (operaciones x rake del torneo).
// Mistery Bounty: se suma el prizepool real guardado en cada transaccion
// (el bounty va aparte y no entra al pozo).
function calcularPozo(transaccionesActivas, torneo) {
  const recaudado = transaccionesActivas.reduce((s, t) => s + Number(t.monto || 0), 0);

  if (torneo && torneo.tipo === 'mistery_bounty') {
    let rake = 0;
    let bounty = 0;
    let prizepool = 0;
    for (const t of transaccionesActivas) {
      const d = t.desglose || {};
      rake += Number(d.rake || 0);
      bounty += Number(d.bounty || 0);
      prizepool += Number(d.prizepool || 0);
    }
    return { recaudado, rake, bounty, pozo: Math.max(0, prizepool) };
  }

  const rake = transaccionesActivas.length * Number((torneo && torneo.rake) || 0);
  return { recaudado, rake, bounty: 0, pozo: Math.max(0, recaudado - rake) };
}


// ------------------------------------------------------
// VISTA COMPLETA PARA LA PANTALLA
// ------------------------------------------------------

function armarVista({ torneo, reloj, transaccionesActivas, ahora = new Date() }) {
  const niveles = reloj.niveles || [];
  const ef = estadoEfectivo(reloj, ahora);
  const actual = niveles.length ? entradaEn(niveles, ef.indice) : null;

  // Proximo nivel de juego (salteando descansos).
  let proximo = null;
  if (niveles.length) {
    for (let k = ef.indice + 1; k < ef.indice + 1 + niveles.length + 1; k++) {
      const e = entradaEn(niveles, k);
      if (e && e.tipo !== 'descanso') {
        proximo = { numero: numeroDeNivel(niveles, k), sb: e.sb, bb: e.bb, ante: e.ante, minutos: e.minutos };
        break;
      }
    }
  }

  // Segundos que faltan para que EMPIECE la posicion "destino".
  const segundosHasta = destino => {
    let s = ef.restantes;
    for (let k = ef.indice + 1; k < destino; k++) s += segundosDe(entradaEn(niveles, k));
    return Math.round(s);
  };

  // Proximo descanso (solo los que estan en la estructura).
  let proximoDescanso = null;
  for (let k = ef.indice + 1; k < niveles.length; k++) {
    if (niveles[k].tipo === 'descanso') {
      proximoDescanso = { minutos: niveles[k].minutos, empiezaEnSegundos: segundosHasta(k) };
      break;
    }
  }

  // Cierre de registro: al FINAL del nivel de juego numero N.
  let registro = { abierto: true, cierreNivel: 0, cierraEnSegundos: null };
  const cierreN = Number(reloj.cierreRegistroNivel || 0);
  if (cierreN > 0 && niveles.length) {
    const posCierre = posicionDelNivel(niveles, cierreN);
    const abierto = reloj.estado !== 'finalizado' && ef.indice <= posCierre;
    registro = {
      abierto,
      cierreNivel: cierreN,
      cierraEnSegundos: abierto ? segundosHasta(posCierre + 1) : 0
    };
  }

  // Jugadores, entradas y fichas.
  const buyins = transaccionesActivas.filter(t => t.tipo === 'buyin').length;
  const reentradas = transaccionesActivas.filter(t => t.tipo === 'recompra').length;
  const eliminaciones = Math.min(Number(reloj.eliminaciones || 0), buyins);
  const jugadoresRestantes = Math.max(0, buyins - eliminaciones);
  const stackInicial = Number(reloj.stackInicial || 0);
  // Si no se cargo un stack de re-entry distinto, se usa el inicial.
  const stackReentry = Number(reloj.stackReentry || 0) || stackInicial;
  const puntosTotales = buyins * stackInicial + reentradas * stackReentry;
  const stackPromedio = jugadoresRestantes > 0 ? Math.round(puntosTotales / jugadoresRestantes) : 0;

  // Pozo y premios.
  const pozo = calcularPozo(transaccionesActivas, torneo);
  const { origen, porcentajes } = porcentajesPremios(buyins, reloj);
  const premios = montosPremios(pozo.pozo, porcentajes, reloj.redondeoPremios)
    .map((p, i) => ({ puesto: i + 1, ...p }));

  return {
    serverNow: ahora.getTime(),
    torneo: {
      nombre: torneo.nombre,
      fecha: torneo.fecha,
      tipo: torneo.tipo || 'normal',
      buyIn: Number(torneo.buyIn || 0),
      reentry: Number(torneo.recompra || 0)
    },
    reloj: {
      estado: reloj.estado,
      indice: ef.indice,
      tipo: actual ? actual.tipo : null,
      numeroNivel: actual ? numeroDeNivel(niveles, ef.indice) : 0,
      sb: actual && actual.tipo !== 'descanso' ? actual.sb : null,
      bb: actual && actual.tipo !== 'descanso' ? actual.bb : null,
      ante: actual && actual.tipo !== 'descanso' ? actual.ante : null,
      minutos: actual ? actual.minutos : 0,
      segundosRestantes: Math.ceil(ef.restantes),
      fueraDeEstructura: niveles.length > 0 && ef.indice >= niveles.length,
      sinEstructura: niveles.length === 0
    },
    proximoNivel: proximo,
    proximoDescanso,
    registro,
    jugadores: {
      buyins,
      reentradas,
      entradasTotales: buyins + reentradas,
      eliminaciones,
      restantes: jugadoresRestantes
    },
    fichas: { stackInicial, stackReentry, puntosTotales, stackPromedio },
    reentradas: {
      ilimitadas: reloj.reentradasIlimitadas !== false,
      maximo: Number(reloj.maxReentradas || 0)
    },
    pozo: pozo.pozo,
    bounty: pozo.bounty,
    premios,
    premiosOrigen: origen
  };
}


// ------------------------------------------------------
// VALIDACIONES
// ------------------------------------------------------

// Valida y limpia una estructura de niveles. Devuelve { niveles } o
// { error }.
function validarNiveles(entrada) {
  if (!Array.isArray(entrada)) return { error: 'La estructura debe ser una lista de niveles.' };
  if (entrada.length > 300) return { error: 'La estructura no puede tener más de 300 filas.' };

  const niveles = [];
  for (let i = 0; i < entrada.length; i++) {
    const n = entrada[i] || {};
    const fila = i + 1;
    const tipo = n.tipo === 'descanso' ? 'descanso' : 'nivel';
    const minutos = Number(n.minutos);
    if (!Number.isInteger(minutos) || minutos < 1 || minutos > 600) {
      return { error: `Fila ${fila}: los minutos deben ser un número entero entre 1 y 600.` };
    }
    if (tipo === 'descanso') {
      niveles.push({ tipo, sb: 0, bb: 0, ante: 0, minutos });
      continue;
    }
    const sb = Number(n.sb);
    const bb = Number(n.bb);
    const ante = Number(n.ante || 0);
    if (![sb, bb, ante].every(Number.isFinite) || sb < 0 || bb <= 0 || ante < 0) {
      return { error: `Fila ${fila}: las ciegas deben ser números válidos (la grande mayor a 0).` };
    }
    if (sb > bb) {
      return { error: `Fila ${fila}: la ciega chica no puede ser mayor que la grande.` };
    }
    niveles.push({ tipo, sb, bb, ante, minutos });
  }

  if (niveles.length && !niveles.some(n => n.tipo === 'nivel')) {
    return { error: 'La estructura tiene que tener al menos un nivel de juego.' };
  }
  return { niveles };
}

// Valida la tabla de premios personalizada. Devuelve { premios } o
// { error }.
function validarPremios(entrada) {
  if (entrada == null) return { premios: [] };
  if (!Array.isArray(entrada)) return { error: 'La tabla de premios debe ser una lista de tramos.' };

  const premios = [];
  for (let i = 0; i < entrada.length; i++) {
    const t = entrada[i] || {};
    const desde = Number(t.desdeJugadores);
    const hasta = t.hastaJugadores == null || t.hastaJugadores === '' ? null : Number(t.hastaJugadores);
    const fila = Number.isFinite(desde) ? `Rango ${desde}-${hasta === null ? '∞' : hasta}` : `Rango ${i + 1}`;
    if (!Number.isInteger(desde) || desde < 1) return { error: `${fila}: "desde" debe ser un entero mayor a 0.` };
    if (hasta !== null && (!Number.isInteger(hasta) || hasta < desde)) {
      return { error: `${fila}: "hasta" debe ser un entero mayor o igual a "desde".` };
    }
    const porcentajes = Array.isArray(t.porcentajes) ? t.porcentajes.map(Number) : [];
    if (!porcentajes.length || porcentajes.some(p => !Number.isFinite(p) || p <= 0)) {
      return { error: `${fila}: los porcentajes deben ser números mayores a 0.` };
    }
    const suma = porcentajes.reduce((s, p) => s + p, 0);
    if (Math.abs(suma - 100) > 0.01) {
      return { error: `${fila}: los porcentajes suman ${Math.round(suma * 100) / 100}%, tienen que sumar 100%.` };
    }
    premios.push({ desdeJugadores: desde, hastaJugadores: hasta, porcentajes });
  }

  // Los tramos no se pueden superponer.
  const ordenados = [...premios].sort((a, b) => a.desdeJugadores - b.desdeJugadores);
  for (let i = 1; i < ordenados.length; i++) {
    const ant = ordenados[i - 1];
    if (ant.hastaJugadores === null || ant.hastaJugadores >= ordenados[i].desdeJugadores) {
      return { error: `Los rangos que empiezan en ${ant.desdeJugadores} y ${ordenados[i].desdeJugadores} jugadores se superponen.` };
    }
  }
  return { premios: ordenados };
}

module.exports = {
  entradaEn,
  segundosDe,
  numeroDeNivel,
  posicionDelNivel,
  estadoEfectivo,
  porcentajesAutomaticos,
  puestosPagos,
  porcentajesPremios,
  tablaAutomatica,
  transaccionesDePrueba,
  montosPremios,
  calcularPozo,
  armarVista,
  validarNiveles,
  validarPremios
};