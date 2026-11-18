// ======================================================
// PREMIO HUNTER
// ======================================================
// El Hunter es para el jugador que MAS bounties cobro en el torneo.
//
//  - Bolsa: suma del aporte Hunter guardado en cada Buy-in / Re-Entry
//    activo (Transaction.desglose.hunter).
//  - Bounties en juego: uno por cada Buy-in / Re-Entry activo con bounty.
//  - Se habilita solo cuando se pagaron todos los bounties, o antes si
//    Direccion lo habilita a mano (Tournament.hunterHabilitado).
//  - Empate: la bolsa se divide en partes iguales entre los empatados
//    (lo que sobra por redondeo va al primero de la lista).
//
// Funcion pura (no toca la base). El MISMO archivo esta en panel-caja y
// en panel-direccion: si se cambia uno, hay que copiarlo al otro.
// ======================================================

function estadoHunter({ torneo, transacciones = [], pagos = [] }) {
  const esBounty = !!torneo && torneo.tipo === 'mistery_bounty';
  const activas = transacciones.filter(t => !t.anulado);
  const vigentes = pagos.filter(p => !p.anulado);

  const bolsa = activas.reduce((s, t) => s + Number((t.desglose || {}).hunter || 0), 0);
  const bountiesTotales = activas.filter(t => Number((t.desglose || {}).bounty || 0) > 0).length;

  // Bounties cobrados por jugador (por DNI; los pagos viejos sin DNI se
  // agrupan por nombre).
  const bountyPagos = vigentes
    .filter(p => p.tipo === 'bounty')
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

  const porJugador = new Map();
  for (const p of bountyPagos) {
    const clave = p.dni ? 'dni:' + p.dni : 'nombre:' + String(p.nombre || '').trim().toLowerCase();
    if (!porJugador.has(clave)) {
      porJugador.set(clave, { dni: p.dni || '', nombre: p.nombre, cantidad: 0, monto: 0, ultimoEn: null });
    }
    const j = porJugador.get(clave);
    j.cantidad++;
    j.monto += Number(p.monto || 0);
    j.ultimoEn = p.createdAt || null;
  }

  // Mas bounties primero; a igual cantidad, el que llego antes.
  const ranking = [...porJugador.values()].sort((a, b) =>
    b.cantidad - a.cantidad || new Date(a.ultimoEn || 0) - new Date(b.ultimoEn || 0)
  );

  const bountiesPagados = bountyPagos.length;
  const completo = bountiesTotales > 0 && bountiesPagados >= bountiesTotales;
  const habilitadoManual = !!(torneo && torneo.hunterHabilitado);
  const habilitado = esBounty && bolsa > 0 && ranking.length > 0 && (completo || habilitadoManual);

  const maximo = ranking.length ? ranking[0].cantidad : 0;
  const lideres = maximo > 0 ? ranking.filter(r => r.cantidad === maximo) : [];

  // Reparto en partes iguales.
  const base = lideres.length ? Math.floor(bolsa / lideres.length) : 0;
  const resto = bolsa - base * lideres.length;

  const pagosHunter = vigentes.filter(p => p.tipo === 'hunter');

  const ganadores = lideres.map((g, i) => {
    const pago = pagosHunter.find(p => (g.dni && p.dni === g.dni) || (!g.dni && p.nombre === g.nombre));
    return {
      dni: g.dni,
      nombre: g.nombre,
      bounties: g.cantidad,
      monto: base + (i === 0 ? resto : 0),
      pagado: !!pago,
      montoPagado: pago ? pago.monto : null,
      hora: pago ? pago.hora : ''
    };
  });

  return {
    esBounty,
    bolsa,
    aporte: Number((torneo && torneo.hunterAporte) || 0),
    bountiesTotales,
    bountiesPagados,
    completo,
    habilitadoManual,
    habilitado,
    empate: lideres.length > 1,
    ranking: ranking.map(r => ({ dni: r.dni, nombre: r.nombre, bounties: r.cantidad, monto: r.monto })),
    ganadores,
    pagado: pagosHunter.reduce((s, p) => s + Number(p.monto || 0), 0)
  };
}

module.exports = { estadoHunter };
