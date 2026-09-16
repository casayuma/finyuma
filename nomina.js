// Sincroniza el personal desde un CSV publicado (la hoja de nómina real,
// publicada a la web, o una copia en el propio repo) hacia la
// configuración de departamentos en Firestore.
//
// Privacidad: SOLO se copian clave, nombre, puesto y departamento. Nunca
// fecha de nacimiento, correo ni CURP — la app es pública (enlace abierto).
const DEPT_COLORS = {
  administracion: "#3E6E8E", restaurante: "#B5504A", cocina: "#6E8C4A",
  mantenimiento: "#8C5A2B", amadellaves: "#6B5B95", recepcion: "#2F8F7A",
};
const DEPT_NAMES = {
  administracion: "Administración", restaurante: "Restaurante", cocina: "Cocina",
  mantenimiento: "Mantenimiento", amadellaves: "Ama de Llaves", recepcion: "Recepción",
};

function stripAccents(s) {
  return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// "Seguridad" cae dentro de Mantenimiento y "SPA" dentro de Recepción —
// Casa Yuma no tiene tarjeta aparte para ninguno de los dos.
function mapDeptoToSlug(depto) {
  const d = stripAccents(depto).toLowerCase().trim();
  if (d.indexOf("administra") !== -1) return "administracion";
  if (d.indexOf("restaur") !== -1) return "restaurante";
  if (d.indexOf("cocina") !== -1) return "cocina";
  if (d.indexOf("seguridad") !== -1) return "mantenimiento";
  if (d.indexOf("mantenim") !== -1) return "mantenimiento";
  if (d.indexOf("ama de llaves") !== -1 || d.indexOf("amadellaves") !== -1) return "amadellaves";
  if (d.indexOf("spa") !== -1) return "recepcion";
  if (d.indexOf("recep") !== -1) return "recepcion";
  return null;
}

// Parser de CSV sencillo pero correcto: soporta campos entre comillas con
// comas/saltos de línea/comillas dobles adentro.
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\r") {
      // ignorar
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

async function fetchNominaDepartments(csvUrl) {
  const resp = await fetch(csvUrl);
  if (!resp.ok) throw new Error("CSV HTTP " + resp.status);
  const text = await resp.text();
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("CSV vacío o sin filas de datos.");

  const header = rows[0].map((h) => stripAccents(String(h)).trim().toUpperCase());
  const idx = {
    clave: header.indexOf("CLAVE COLABORADOR"),
    nombre: header.indexOf("NOMBRE"),
    puesto: header.indexOf("PUESTO"),
    depto: header.indexOf("CODE"),
  };
  if (idx.clave === -1 || idx.nombre === -1 || idx.puesto === -1 || idx.depto === -1) {
    throw new Error("No se encontraron las columnas esperadas (CLAVE COLABORADOR / NOMBRE / PUESTO / CODE). Encabezados vistos: " + rows[0].join(" | "));
  }

  // Firestore no permite arrays anidados — cada colaborador es un objeto
  // {clave,nombre,puesto}, no una tupla [clave,nombre,puesto].
  const bySlug = { administracion: [], restaurante: [], cocina: [], mantenimiento: [], amadellaves: [], recepcion: [] };
  const vacCounters = {};

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const nombre = String(row[idx.nombre] || "").trim();
    const puesto = String(row[idx.puesto] || "").trim();
    const depto = String(row[idx.depto] || "").trim();
    let clave = String(row[idx.clave] || "").trim();
    if (!nombre && !puesto) continue; // fila basura/vacía

    const slug = mapDeptoToSlug(depto);
    if (!slug) continue;

    if (!clave) {
      if (!puesto) continue; // vacante sin puesto especificado, se omite
      vacCounters[slug] = (vacCounters[slug] || 0) + 1;
      clave = "VAC-" + slug.slice(0, 3).toUpperCase() + "-" + vacCounters[slug];
      bySlug[slug].push({ clave, nombre: "VACANTE", puesto });
      continue;
    }
    bySlug[slug].push({ clave, nombre, puesto });
  }

  const departments = {};
  ["administracion", "cocina", "amadellaves", "recepcion"].forEach((slug) => {
    departments[slug] = { name: DEPT_NAMES[slug], color: DEPT_COLORS[slug], employees: bySlug[slug] };
  });
  departments.restaurante = {
    name: DEPT_NAMES.restaurante, color: DEPT_COLORS.restaurante, groups: [
      { label: "Servicio", employees: bySlug.restaurante.filter((e) => !/bartender/i.test(e.puesto)) },
      { label: "Barra", employees: bySlug.restaurante.filter((e) => /bartender/i.test(e.puesto)) },
    ],
  };
  departments.mantenimiento = { name: DEPT_NAMES.mantenimiento, color: DEPT_COLORS.mantenimiento, employees: bySlug.mantenimiento };
  return departments;
}

module.exports = { fetchNominaDepartments, mapDeptoToSlug, parseCSV };
