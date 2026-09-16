// Aritmética de fechas en UTC puro (para que sumar/restar días no se
// desfase por husos horarios) — la única vez que sí importa el huso real
// es para saber qué día es "hoy" en Puerto Escondido (mxTodayISO).
function mxTodayISO() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // locale en-CA -> "YYYY-MM-DD"
}

function addDaysISO(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mondayOfISO(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  return addDaysISO(iso, -dow);
}

module.exports = { mxTodayISO, addDaysISO, mondayOfISO };
