// Ocupación / llegadas / salidas desde Cloudbeds — mismo algoritmo que las
// versiones anteriores: UNA sola llamada (con paginación) a
// getReservations, sin pedir el detalle de cada reservación por separado.
const OCCUPIED_STATUSES = { confirmed: true, checked_in: true, checked_out: true };
// NO cuentan: not_confirmed, canceled, no_show.

async function fetchReservations(token, propertyId, weekStart, rangeEnd) {
  let reservations = [];
  let page = 1;
  while (true) {
    // OJO: el filtro correcto para "qué reservaciones tocan esta semana" es
    // por traslape, no por contención — checkInTo/checkOutFrom (no
    // checkInFrom/checkOutTo), para no perder huéspedes que ya estaban
    // hospedados desde antes del lunes, o que siguen hospedados después del
    // domingo. computeOccupancyMetrics ya filtra día por día con precisión;
    // aquí solo hace falta no dejar fuera reservaciones que sí aplican.
    const url = "https://api.cloudbeds.com/api/v1.3/getReservations"
      + "?propertyID=" + encodeURIComponent(propertyId)
      + "&checkInTo=" + rangeEnd
      + "&checkOutFrom=" + weekStart
      + "&pageSize=100&pageNumber=" + page;
    const resp = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (resp.status !== 200) {
      const text = await resp.text().catch(() => "");
      throw new Error("getReservations HTTP " + resp.status + ": " + text.slice(0, 300));
    }
    const body = await resp.json();
    if (!body.success) throw new Error("getReservations success=false");
    const data = body.data || [];
    reservations = reservations.concat(data);
    const total = typeof body.total === "number" ? body.total : reservations.length;
    if (reservations.length >= total || data.length === 0) break;
    page++;
  }
  return reservations;
}

function computeOccupancyMetrics(reservations, days, totalRooms) {
  const occupied = [0, 0, 0, 0, 0, 0, 0];
  const arrivals = [0, 0, 0, 0, 0, 0, 0];
  const departures = [0, 0, 0, 0, 0, 0, 0];
  let considered = 0;

  reservations.forEach((res) => {
    if (!OCCUPIED_STATUSES[res.status]) return;
    considered++;
    const s = res.startDate, e = res.endDate;
    if (!s || !e) return;
    for (let i = 0; i < 7; i++) {
      const d = days[i];
      if (s <= d && d < e) occupied[i]++;
      if (s === d) arrivals[i]++;
      if (e === d) departures[i]++;
    }
  });

  const pct = occupied.map((o) => Math.min(100, Math.round((o / totalRooms) * 100)));
  return { pct, arrivals, departures, considered };
}

module.exports = { fetchReservations, computeOccupancyMetrics };
