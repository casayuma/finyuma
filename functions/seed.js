// Copia de respaldo del personal, para el primerísimo arranque antes de que
// corra la sincronización de nómina. En cuanto corre una vez, esto deja de
// usarse — lo real vive en Firestore (config/departments) y se mantiene solo.
//
// Nota: Firestore NO permite arrays anidados (un array cuyo contenido son
// otros arrays) dentro de un documento — por eso cada colaborador es un
// objeto {clave,nombre,puesto} y no una tupla [clave,nombre,puesto] como en
// las versiones anteriores (que guardaban esto como texto/JSON, donde esa
// restricción no aplica).
function e(clave, nombre, puesto) { return { clave, nombre, puesto }; }

const DEFAULT_DEPARTMENTS = {
  administracion: {
    name: "Administración", color: "#3E6E8E", employees: [
      e("CY001", "Manuel Arturo Otazo Aponte", "Director General"),
      e("CY064", "Jorge Guillén Garbuno", "Gerente General"),
      e("CY002", "Amairani Jared Rojas Alvarado", "Gerente Administrativo"),
      e("CY070", "América Arroniz", "Gerente Administrativo"),
      e("CY060", "Rainier Jetzahi Ramírez Vasquez", "Encargado de Compras"),
      e("CY005", "Horacio Muñoz Martínez", "Coordinador de Ventas y Eventos"),
    ],
  },
  restaurante: {
    name: "Restaurante", color: "#B5504A", groups: [
      { label: "Servicio", employees: [
        e("CY071", "José de Jesús Segoviano Farjas", "Dir. de Alimentos y Bebidas"),
        e("CY007", "Ricardo Ojeda Montuy", "Gerente de A&B"),
        e("CY011", "Scarlet Libertad Rios Gutierrez", "Mesera"),
        e("VAC-RES-1", "VACANTE", "Mesero"),
        e("VAC-RES-2", "VACANTE", "Mesero"),
        e("CY065", "Cristian David Naranjo Hernandez", "Capitán"),
        e("CY066", "Marco Antonio Spezzia Berra", "Capitán"),
        e("CY003", "Gibran Antonio Ortiz Andrade", "Mesero"),
        e("CY008", "Gilberto Valencia Ambrosio", "Mesero"),
        e("CY009", "Fredy Mejía Jimenez", "Mesero"),
        e("CY014", "Ana Itzel Ayala Terronez", "Mesera"),
      ] },
      { label: "Barra", employees: [
        e("VAC-RES-3", "VACANTE", "Bartender"),
        e("CY063", "Salvador Carrillo Espinoza", "Bartender"),
        e("CY010", "Jack Anthony Garcia Silvestre", "Bartender"),
      ] },
    ],
  },
  cocina: {
    name: "Cocina", color: "#6E8C4A", employees: [
      e("CY062", "Lizette Lopez Lopez", "Chef Ejecutiva"),
      e("CY018", "Plácido Maurilio García Pérez", "Encargado de Turno - PM"),
      e("CY019", "Miriam Lopez Sanchez", "Sous Chef"),
      e("CY020", "María del Rosario García Salvador", "Cocinera"),
      e("CY021", "Jaime Martínez Gómez", "Cocinero"),
      e("CY022", "Manuel Olivera Contreras", "Cocinero"),
      e("CY069", "Monica Nayeli Benavides Lopez", "Cocinero"),
      e("CY023", "Candelaria Sánchez Lorenzo", "Cocinero"),
      e("CY044", "Angela Francisco Vargas", "Lavaloza"),
      e("CY013", "Antonio Salvador Sánchez", "Lavaloza"),
    ],
  },
  mantenimiento: {
    name: "Mantenimiento", color: "#8C5A2B", employees: [
      e("CY025", "Egbert Cruz García", "Gerente de Mantenimiento"),
      e("CY027", "Gerardo Tereso Ruiz", "Aux. de Mantenimiento"),
      e("CY004", "Orlando Yael Martínez García", "Técnico de Mantenimiento"),
      e("VAC-MAN-1", "VACANTE", "Jardinero"),
      e("CY015", "Edgar Samuel Gonzalez", "Aux. de Mantenimiento"),
      e("CY040", "Antonino Hernández Cruz", "Seguridad"),
      e("CY067", "Pedro Velasquez Luna", "Seguridad"),
    ],
  },
  amadellaves: {
    name: "Ama de Llaves", color: "#6B5B95", employees: [
      e("CY029", "Neri Angelina Contreras Pacheco", "Jefa de Ama de Llaves"),
      e("CY031", "Margarita Díaz Canseco", "Supervisora de Camaristas"),
      e("CY030", "Karen Estrella Ventura Ruíz", "Camarista"),
      e("CY033", "Modesta Luna Hernández", "Áreas Públicas"),
      e("CY046", "Italia Ortiz Dias", "Áreas Públicas"),
      e("CY058", "Karen Itzel Santiago Rios", "Áreas Públicas"),
      e("CY012", "Nanci Ramirez Escamilla", "Áreas Públicas"),
    ],
  },
  recepcion: {
    name: "Recepción", color: "#2F8F7A", employees: [
      e("CY035", "Aida Carrillo Patiño", "Lead House Manager"),
      e("CY037", "Omar Emiliano de la Tejera Zamorano", "House Manager"),
      e("CY038", "Rodolfo Ramirez Perez", "House Manager"),
      e("CY057", "Arleth Paola Anicacio Antunez", "House Manager"),
      e("CY039", "Jesus Israel Castillo Hernández", "Auditor"),
      e("CY041", "Rosalba Pacheco Ramos", "Masajista"),
      e("CY050", "Abraham Leonardo Arteaga Garcia", "Masajista"),
    ],
  },
};

module.exports = { DEFAULT_DEPARTMENTS };
