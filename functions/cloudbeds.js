// Ocupación / llegadas / salidas desde Cloudbeds.
//
// La ocupación NO se reconstruye a mano contando reservaciones ni cuartos
// asignados — eso es justo lo que causaba discrepancias contra lo que
// Cloudbeds muestra. En vez de eso se usa la disponibilidad real que
// Cloudbeds ya calcula: getRoomTypes (capacidad por tipo de cuarto) +
// getRatePlans?detailedRates=true (cuartos disponibles por día y por tipo).
// Vendidas = capacidad − disponibles, sumado sobre todos los tipos. Este es
// el mismo cálculo, ya validado, que usa el dashboard de "Ocupación en
// tiempo real" (48%=12/25 y 28%=7/25 exactos contra Cloudbeds en vivo).
//
// Llegadas y salidas sí necesitan el detalle de cada reservación
// (startDate/endDate), así que esas dos siguen viniendo de getReservations.
const OCCUPIED_STATUSES = { confirmed: true, checked_in: true, checked_out: true };
// NO cuentan: not_confirmed, canceled, no_show. (Aplica solo a llegadas/salidas.)

async function cbFetch(token, path) {
  const url = "https://api.cloudbeds.com/api/v1.3" + path;
  const resp = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (resp.status !== 200) {
    const text = await resp.text().catch(() => "");
    throw new Error("Cloudbeds " + path + " HTTP " + resp.status + ": " + text.slice(0, 300));
  }
  const body = await resp.json();
  if (!body.success) throw new Error("Cloudbeds " + path + " success=false");
  return body;
}

async function fetchReservations(token, propertyId, weekStart, rangeEnd) {
  let reservations = [];
  let page = 1;
  while (true) {
    // OJO: el filtro correcto para "qué reservaciones tocan esta semana" es
    // por traslape, no por contención — checkInTo/checkOutFrom (no
    // checkInFrom/checkOutTo), para no perder huéspedes que ya estaban
    // hospedados desde antes del lunes, o que siguen hospedados después del
    // domingo.
    const path = "/getReservations"
      + "?propertyID=" + encodeURIComponent(propertyId)
      + "&checkInTo=" + rangeEnd
      + "&checkOutFrom=" + weekStart
      + "&pageSize=100&pageNumber=" + page;
    const body = await cbFetch(token, path);
    const data = body.data || [];
    reservations = reservations.concat(data);
    const total = typeof body.total === "number" ? body.total : reservations.length;
    if (reservations.length >= total || data.length === 0) break;
    page++;
  }
  return reservations;
}

// Capacidad total y cuartos vendidos por día, directo de la disponibilidad
// real de Cloudbeds — sin tocar status de reservaciones ni contarlas a mano.
async function fetchOccupancyByDay(token, propertyId, weekStart, rangeEnd, days) {
  const roomTypes = (await cbFetch(token, "/getRoomTypes?propertyID=" + encodeURIComponent(propertyId))).data || [];
  const capacityByType = {};
  roomTypes.forEach((rt) => { capacityByType[rt.roomTypeName] = rt.roomTypeUnits || 0; });

  const plans = (await cbFetch(
    token,
    "/getRatePlans?propertyID=" + encodeURIComponent(propertyId)
      + "&startDate=" + weekStart + "&endDate=" + rangeEnd + "&detailedRates=true"
  )).data || [];

  const soldByDay = {}; // "YYYY-MM-DD" -> cuartos vendidos, sumado sobre todos los tipos
  const seenType = {};  // varias tarifas pueden ser del mismo tipo — contarlo una sola vez
  let totalRooms = 0;   // solo tipos que SÍ aparecen en getRatePlans — así "Day Pass" (o
                        // cualquier producto que no sea un cuarto de noche real) queda
                        // afuera solo, sin tener que excluirlo a mano por nombre.
  plans.forEach((p) => {
    if (seenType[p.roomTypeID]) return;
    seenType[p.roomTypeID] = true;
    const cap = capacityByType[p.roomTypeName] || 0;
    totalRooms += cap;
    (p.roomRateDetailed || []).forEach((day) => {
      const sold = Math.max(0, cap - (day.roomsAvailable || 0));
      soldByDay[day.date] = (soldByDay[day.date] || 0) + sold;
    });
  });

  const pct = days.map((d) => Math.min(100, Math.round(((soldByDay[d] || 0) / totalRooms) * 100)));
  return { pct, totalRooms };
}
// "days" puede cubrir varias semanas seguidas (no solo 7 días) — quien
// llama (syncOcupacion) es quien decide el horizonte y luego reparte estos
// arreglos en documentos semanales.
async function computeOccupancyMetrics(token, propertyId, reservations, days, rangeStart, rangeEnd) {
  const n = days.length;
  const arrivals = new Array(n).fill(0);
  const departures = new Array(n).fill(0);
  let considered = 0;

  reservations.forEach((res) => {
    if (!OCCUPIED_STATUSES[res.status]) return;
    considered++;
    const s = res.startDate, e = res.endDate;
    if (!s || !e) return;
    for (let i = 0; i < n; i++) {
      const d = days[i];
      if (s === d) arrivals[i]++;
      if (e === d) departures[i]++;
    }
  });

  const { pct, totalRooms } = await fetchOccupancyByDay(token, propertyId, rangeStart, rangeEnd, days);
  return { pct, arrivals, departures, considered, totalRooms };
}
