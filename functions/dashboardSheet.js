// Ocupación leída de la hoja "Dashboard Status Hotel" (que mantiene al día
// el proyecto Apps Script "Dashboard" hablando con Cloudbeds por su cuenta)
// en vez de llamar a Cloudbeds directamente desde esta función.
//
// Por qué: Cloudbeds rota el refresh token cada vez que se usa. Dos
// sistemas pidiendo su propio token por separado (este, y "Dashboard")
// terminan invalidándose uno al otro — eso fue justo lo que pasó el 30 de
// octubre: "Dashboard" renovó su copia y la de syncOcupacion dejó de
// servir, y como aquí no había ningún mecanismo de renovación propio, se
// quedó atorada fallando con 401 desde entonces.
//
// Con un solo sistema (Dashboard) hablando con Cloudbeds, y esta función
// solo leyendo esa hoja ya sincronizada, no hay con qué chocar.
//
// Limitación conocida y aceptada: "Dashboard" solo mantiene fresca una
// ventana rodante corta (~2 días atrás, 14 adelante) de esa hoja. Los días
// fuera de esa ventana no tienen capacidad/vendidos todavía, así que salen
// en 0% hasta que se acerquen más — igual que pasaba antes en el sistema
// de Apps Script que leía de esta misma hoja.

const { google } = require("googleapis");

const DASHBOARD_SHEET_ID = "1i9j_JoVPZn5WDXXO50Em-RDLjAeFOSy7BN3HN1d_Y1Y"; // "Dashboard Status Hotel"
const OCCUPANCY_TAB = "Occupancy History and Forecast by Room Type";

// Las fechas de "Stay Date" vienen como número de serie de Sheets (días
// desde 1899-12-30) cuando se piden con valueRenderOption
// UNFORMATTED_VALUE — así evitamos depender del formato de visualización
// de la celda (que podría ser M/D/YYYY, YYYY-MM-DD, etc. según cómo esté
// configurada la hoja).
function sheetSerialToISO(serial) {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function cellToISO(raw) {
  if (typeof raw === "number") return sheetSerialToISO(raw);
  return String(raw == null ? "" : raw).trim();
}

// Se reusa el cliente entre invocaciones (misma instancia de la función) —
// GoogleAuth con credenciales por defecto toma automáticamente la cuenta
// de servicio del servicio de Cloud Run, sin necesidad de llave/JSON.
let sheetsClientPromise = null;
function getSheetsClient() {
  if (!sheetsClientPromise) {
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    sheetsClientPromise = auth.getClient().then((authClient) =>
      google.sheets({ version: "v4", auth: authClient })
    );
  }
  return sheetsClientPromise;
}

/**
 * days: arreglo de fechas "YYYY-MM-DD" (puede cubrir varias semanas
 * seguidas). Regresa { pct, totalRooms }.
 *
 * arrivals/departures NO están disponibles desde esta hoja (no trae
 * detalle de reservación por huésped, solo vendidos/capacidad por tipo y
 * día) — quien llama debe omitirlos; el dashboard ya sabe no dibujar las
 * flechas ↑/↓ cuando faltan.
 */
async function fetchOccupancyFromSheet(days) {
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: DASHBOARD_SHEET_ID,
    range: OCCUPANCY_TAB,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const values = resp.data.values || [];
  if (values.length < 2) {
    throw new Error('La pestaña "' + OCCUPANCY_TAB + '" está vacía.');
  }

  const header = values[0].map((h) => String(h).trim());
  const idx = {
    date: header.indexOf("Stay Date"),
    sold: header.indexOf("Rooms Sold"),
    cap: header.indexOf("Capacity"),
  };
  if (idx.date === -1 || idx.sold === -1 || idx.cap === -1) {
    throw new Error(
      'No se encontraron las columnas esperadas (Stay Date / Rooms Sold / Capacity) en "' +
        OCCUPANCY_TAB + '". Encabezados vistos: ' + values[0].join(" | ")
    );
  }

  const soldByDay = {}, capByDay = {};
  days.forEach((d) => { soldByDay[d] = 0; capByDay[d] = 0; });

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const dateIso = cellToISO(row[idx.date]);
    if (soldByDay[dateIso] === undefined) continue; // fuera del horizonte pedido
    soldByDay[dateIso] += Number(row[idx.sold]) || 0;
    capByDay[dateIso] += Number(row[idx.cap]) || 0;
  }

  const pct = days.map((d) => {
    const cap = capByDay[d];
    if (!cap) return 0;
    return Math.min(100, Math.round((soldByDay[d] / cap) * 100));
  });

  // Capacidad total, tomada del primer día del horizonte que sí trae dato
  // — si por lo que sea ningún día trae capacidad todavía, se usa 25
  // (cuartos reales de Casa Yuma) como respaldo, igual que antes.
  let totalRooms = 25;
  for (let i = 0; i < days.length; i++) {
    if (capByDay[days[i]]) { totalRooms = capByDay[days[i]]; break; }
  }

  return { pct, totalRooms };
}

module.exports = { fetchOccupancyFromSheet };
