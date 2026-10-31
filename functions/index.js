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
const { defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const { computeLoginUsers } = require("./departments");
const { DEFAULT_DEPARTMENTS } = require("./seed");
const { fetchNominaDepartments } = require("./nomina");
const { fetchOccupancyFromSheet } = require("./dashboardSheet");
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

// Cuántas semanas COMPLETAS además de la actual se calculan cada corrida —
// para que un líder pueda ver la ocupación esperada al armar el horario de
// semanas que todavía no llegan (antes solo existía el dato de "esta
// semana", y navegar a futuro se quedaba sin nada). 8 = ~2 meses de
// margen. Nota: solo las primeras ~2 semanas traen dato real — ver
// dashboardSheet.js.
const OCC_WEEKS_AHEAD = 8;

// syncOcupacion YA NO le pide su propio token a Cloudbeds (ver
// dashboardSheet.js para el porqué: dos sistemas renovando el mismo
// refresh token se invalidan uno al otro). En vez de eso, lee la
// ocupación que el proyecto Apps Script "Dashboard" ya mantiene fresca en
// la hoja "Dashboard Status Hotel".
exports.syncOcupacion = onSchedule(
  { schedule: "every 5 minutes", timeoutSeconds: 240 },
  async () => {
    const todayIso = mxTodayISO();
    const firstWeekStart = mondayOfISO(todayIso);
    const totalWeeks = OCC_WEEKS_AHEAD + 1;
    const totalDays = totalWeeks * 7;
    const days = [];
    for (let i = 0; i < totalDays; i++) days.push(addDaysISO(firstWeekStart, i));

    let m;
    try {
      m = await fetchOccupancyFromSheet(days);
    } catch (err) {
      logger.error("Error leyendo la hoja 'Dashboard Status Hotel', no se modificó el historial: " + err);
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
          // arrivals/departures ya no están disponibles leyendo de la hoja
          // de Dashboard (no trae detalle por huésped) — se omiten a
          // propósito; el dashboard ya sabe no dibujar las flechas ↑/↓
          // cuando faltan.
          totalRooms: m.totalRooms,
          updatedAt,
        }));
      }
      await Promise.all(writes);
    } catch (err) {
      logger.error("Error guardando ocupación en Firestore: " + err);
      return;
    }
    logger.info("Ocupación actualizada (vía hoja Dashboard) — " + totalWeeks + " semanas desde " + firstWeekStart + " — semana actual pct=[" + m.pct.slice(0, 7).join(",") + "]");
  }
);
