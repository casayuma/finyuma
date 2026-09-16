// Quién puede iniciar sesión y editar se define aquí a mano, no en la hoja
// de nómina — si cambia quién administra o lidera un departamento, se
// ajusta en este archivo, se sube con git push, y el despliegue automático
// (ver .github/workflows/deploy.yml) lo sube solo.
const SLUGS = ["administracion", "restaurante", "cocina", "mantenimiento", "amadellaves", "recepcion"];

const ADMIN_CLAVES = ["CY001", "CY064"]; // Manuel, Jorge — ven y editan TODO.
const LEADER_CLAVES = [
  "CY071", // José de Jesús Segoviano Farjas — Dir. de Alimentos y Bebidas (restaurante)
  "CY007", // Ricardo Ojeda Montuy — Gerente de A&B (restaurante)
  "CY062", // Lizette Lopez Lopez — Chef Ejecutiva (cocina)
  "CY025", // Egbert Cruz García — Gerente de Mantenimiento (mantenimiento)
  "CY029", // Neri Angelina Contreras Pacheco — Jefa de Ama de Llaves (amadellaves)
  "CY035", // Aida Carrillo Patiño — Lead House Manager (recepcion)
];

function deptRowsServer(departments, slug) {
  const d = departments[slug];
  if (!d) return [];
  if (d.groups) {
    const out = [];
    d.groups.forEach((g) => {
      (g.employees || []).forEach((e) => out.push({ clave: e.clave, nombre: e.nombre, puesto: e.puesto, group: g.label }));
    });
    return out;
  }
  return (d.employees || []).map((e) => ({ clave: e.clave, nombre: e.nombre, puesto: e.puesto, group: null }));
}

function computeLoginUsers(departments) {
  const users = [];
  SLUGS.forEach((slug) => {
    deptRowsServer(departments, slug).forEach((r) => {
      if (r.clave.indexOf("VAC-") === 0) return; // vacantes no inician sesión
      const isAdmin = ADMIN_CLAVES.indexOf(r.clave) !== -1;
      const isLeader = LEADER_CLAVES.indexOf(r.clave) !== -1;
      if (!isAdmin && !isLeader) return; // solo líderes y admins inician sesión
      users.push({ clave: r.clave, nombre: r.nombre, scope: isAdmin ? "all" : slug });
    });
  });
  users.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return users;
}

module.exports = { SLUGS, ADMIN_CLAVES, LEADER_CLAVES, deptRowsServer, computeLoginUsers };
