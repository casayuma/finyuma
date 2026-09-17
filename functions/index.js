/**
 * Cloud Functions de la Bitácora de Turnos — Casa Yuma.
 *
 * loginStart / loginSubmit / saveSchedule: llamadas desde el cliente
 * (Firebase Web SDK, httpsCallable). El PIN nunca sale del servidor, y
 * saveSchedule siempre vuelve a comprobar aquí — nunca confía en lo que el
 * navegador diga que es su "scope".
 *
 * syncNomina / syncOcupacion: corren solas, programadas (Cloud Scheduler),
 * igual que los triggers de las versiones anteriores.
 */
const crypto = require("crypto");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const { computeLoginUsers } = require("./departments");
const { DEFAULT_DEPARTMENTS } = require("./seed");
const { fetchNominaDepartments } = require("./nomina");
const { fetchReservations, computeOccupancyMetrics } = require("./cloudbeds");
const { mxTodayISO, addDaysISO, mondayOfISO } = require("./dates");

initializeApp();
const db = getFirestore();

function hashPin(clave, pin) {
  return crypto.createHash("sha256").update(clave + ":" + pin).digest("hex");
}

// Igual que Data.gs/Config.gs en las versiones anteriores: si el documento
// de configuración todavía no existe (proyecto recién desplegado, antes de
// la primera corrida de syncNomina), lo crea con la copia de respaldo —
// así el cliente (que lee este documento directo, en vivo) nunca se queda
// viendo "sin departamentos" mientras espera el primer sync.
async function getDepartments() {
  const ref = db.collection("config").doc("departments");
  const snap = await ref.get();
  if (snap.exists) return snap.data();
  await ref.set(DEFAULT_DEPARTMENTS);
  return DEFAULT_DEPARTMENTS;
}

/* ================= login ================= */

// Paso 1: el cliente ya eligió su nombre de una lista (nunca escribe
// libremente), esto solo confirma si ya tiene PIN o va a crear uno.
exports.loginStart = onCall(async (request) => {
  const clave = String((request.data && request.data.clave) || "");
  const departments = await getDepartments();
  const users = computeLoginUsers(departments);
  const u = users.find((x) => x.clave === clave);
  if (!u) return { ok: false, error: "Colaborador no encontrado." };

  const userRef = db.collection("users").doc(clave);
  const userSnap = await userRef.get();
  let rec;
  if (!userSnap.exists) {
    rec = { clave, nombre: u.nombre, scope: u.scope, pinHash: "" };
    await userRef.set(rec);
  } else {
    rec = userSnap.data();
  }
  return { ok: true, clave, nombre: rec.nombre || u.nombre, scope: rec.scope || u.scope, tienePin: !!rec.pinHash };
});

// Paso 2: verifica el PIN (o lo crea la primera vez). Nunca regresa el
// hash al cliente — solo ok/error y, si todo bien, la sesión.
exports.loginSubmit = onCall(async (request) => {
  const data = request.data || {};
  const clave = String(data.clave || "");
  const pin = String(data.pin || "");
  const pin2 = data.pin2 == null ? null : String(data.pin2);
  if (!/^\d{4,6}$/.test(pin)) return { ok: false, error: "El PIN debe ser de 4 a 6 dígitos." };

  const userRef = db.collection("users").doc(clave);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return { ok: false, error: "Colaborador no encontrado, vuelve a intentar." };
  const rec = userSnap.data();

  if (rec.pinHash) {
    if (hashPin(clave, pin) !== rec.pinHash) return { ok: false, error: "PIN incorrecto." };
  } else {
    if (pin !== pin2) return { ok: false, error: "Los PIN no coinciden." };
    await userRef.update({ pinHash: hashPin(clave, pin) });
  }
  return { ok: true, session: { clave, nombre: rec.nombre, scope: rec.scope } };
});

/* ================= guardar horario ================= */

exports.saveSchedule = onCall(async (request) => {
  const data = request.data || {};
  const clave = String(data.clave || "");
  const slug = String(data.slug || "");
  const weekStart = String(data.weekStart || "");
  const shifts = data.shifts || {};
  const notes = data.notes || {};
  if (!clave || !slug || !weekStart) return { ok: false, error: "Solicitud incompleta." };

  const userSnap = await db.collection("users").doc(clave).get();
  if (!userSnap.exists) return { ok: false, error: "Sesión inválida — vuelve a iniciar sesión." };
  const rec = userSnap.data();
  if (rec.scope !== "all" && rec.scope !== slug) {
    return { ok: false, error: "No autorizado para editar este departamento." };
  }

  const updatedAt = new Date().toISOString();
  const docId = slug + "__" + weekStart;
  await db.collection("schedules").doc(docId).set({
    slug, weekStart, shifts, notes, updatedAt, updatedBy: rec.nombre,
  });
  return { ok: true, updatedAt, updatedBy: rec.nombre };
});

/* ================= sincronización programada ================= */

const NOMINA_CSV_URL = defineString("NOMINA_CSV_URL", { default: "" });

exports.syncNomina = onSchedule(
  { schedule: "every 24 hours", timeZone: "America/Mexico_City" },
  async () => {
    const url = NOMINA_CSV_URL.value();
    if (!url) { logger.info("NOMINA_CSV_URL no configurado — se omite."); return; }
    const deptRef = db.collection("config").doc("departments");
    const snap = await deptRef.get();
    const current = snap.exists ? snap.data() : null;
    let fresh;
    try {
      fresh = await fetchNominaDepartments(url);
    } catch (err) {
      logger.error("Error leyendo CSV de nómina: " + err);
      return;
    }
    if (current && JSON.stringify(current) === JSON.stringify(fresh)) {
      logger.info("Nómina sin cambios.");
      return;
    }
    await deptRef.set(fresh);
    logger.info("Nómina actualizada.");
  }
);

const CLOUDBEDS_TOKEN = defineSecret("CLOUDBEDS_TOKEN");
const CLOUDBEDS_PROPERTY_ID = defineString("CLOUDBEDS_PROPERTY_ID", { default: "" });

// Cuántas semanas COMPLETAS además de la actual se calculan cada corrida —
// para que un líder pueda ver la ocupación esperada al armar el horario de
// semanas que todavía no llegan (antes solo existía el dato de "esta
// semana", y navegar a futuro se quedaba sin nada). 8 = ~2 meses de margen.
const OCC_WEEKS_AHEAD = 8;

exports.syncOcupacion = onSchedule(
  // Con 9 semanas de por medio (en vez de 1) la consulta a Cloudbeds y la
  // escritura a Firestore tardan más — timeoutSeconds default (60s) se
  // quedaba corto y la función se cortaba a la mitad. 240s da margen de
  // sobra sin acercarse a los 5 minutos entre corridas.
  { schedule: "every 5 minutes", secrets: [CLOUDBEDS_TOKEN], timeoutSeconds: 240 },
  async () => {
    const token = CLOUDBEDS_TOKEN.value();
    const propertyId = CLOUDBEDS_PROPERTY_ID.value();
    if (!token || !propertyId) { logger.info("Faltan credenciales de Cloudbeds — se omite."); return; }

    const todayIso = mxTodayISO();
    const firstWeekStart = mondayOfISO(todayIso);
    const totalWeeks = OCC_WEEKS_AHEAD + 1;
    const totalDays = totalWeeks * 7;
    const rangeEnd = addDaysISO(firstWeekStart, totalDays);
    const days = [];
    for (let i = 0; i < totalDays; i++) days.push(addDaysISO(firstWeekStart, i));

    let m;
    try {
      const reservations = await fetchReservations(token, propertyId, firstWeekStart, rangeEnd);
      m = await computeOccupancyMetrics(token, propertyId, reservations, days, firstWeekStart, rangeEnd);
    } catch (err) {
      logger.error("Error consultando Cloudbeds, no se modificó el historial: " + err);
      return;
    }

    const updatedAt = new Date().toISOString();
    try {
      const writes = [];
      for (let w = 0; w < totalWeeks; w++) {
        const weekStart = addDaysISO(firstWeekStart, w * 7);
        const start = w * 7, end = start + 7;
        writes.push(db.collection("occupancy").doc(weekStart).set({
          weekStart,
          pct: m.pct.slice(start, end),
          arrivals: m.arrivals.slice(start, end),
          departures: m.departures.slice(start, end),
          // reservationsConsidered es del horizonte completo (no por semana
          // individual) — solo es un dato de diagnóstico, no se muestra en
          // el dashboard.
          reservationsConsidered: m.considered,
          totalRooms: m.totalRooms,
          updatedAt,
        }));
      }
      await Promise.all(writes);
    } catch (err) {
      logger.error("Error guardando ocupación en Firestore: " + err);
      return;
    }
    logger.info("Ocupación actualizada — " + totalWeeks + " semanas desde " + firstWeekStart + " — semana actual pct=[" + m.pct.slice(0,7).join(",") + "]");
  }
);
