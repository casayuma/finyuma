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
const TOTAL_ROOMS = defineString("TOTAL_ROOMS", { default: "25" });

exports.syncOcupacion = onSchedule(
  { schedule: "every 5 minutes", secrets: [CLOUDBEDS_TOKEN] },
  async () => {
    const token = CLOUDBEDS_TOKEN.value();
    const propertyId = CLOUDBEDS_PROPERTY_ID.value();
    const totalRooms = Number(TOTAL_ROOMS.value() || 25);
    if (!token || !propertyId) { logger.info("Faltan credenciales de Cloudbeds — se omite."); return; }

    const todayIso = mxTodayISO();
    const weekStart = mondayOfISO(todayIso);
    const rangeEnd = addDaysISO(weekStart, 7);
    const days = [];
    for (let i = 0; i < 7; i++) days.push(addDaysISO(weekStart, i));

    let reservations;
    try {
      reservations = await fetchReservations(token, propertyId, weekStart, rangeEnd);
    } catch (err) {
      logger.error("Error consultando Cloudbeds, no se modificó el historial: " + err);
      return;
    }
    const m = computeOccupancyMetrics(reservations, days, totalRooms);
    await db.collection("occupancy").doc(weekStart).set({
      weekStart, pct: m.pct, arrivals: m.arrivals, departures: m.departures,
      reservationsConsidered: m.considered, totalRooms, updatedAt: new Date().toISOString(),
    });
    logger.info("Ocupación actualizada — semana " + weekStart + ": pct=[" + m.pct.join(",") + "]");
  }
);
