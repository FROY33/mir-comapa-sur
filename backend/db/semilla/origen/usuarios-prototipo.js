// Usuarios del prototipo, congelados el 10/10/2026 desde session.js (commit c8c3a37).
// HU-R7-01 quitó MOCK_USERS de session.js al conectar el login real; el extractor de
// TEC-04 los sigue necesitando para regenerar usuarios.csv. Sin contraseñas.
var MOCK_USERS = [
  {
    "id": "adm-001",
    "email": "admin@comapa.mx",
    "nombre": "Leticia Solís",
    "iniciales": "LS",
    "rol": "Administrador",
    "gerencia": "Planeación Estratégica",
    "redirect": "dashboard-inicio.html"
  },
  {
    "id": "rev-001",
    "email": "revisor@comapa.mx",
    "nombre": "Carlos Mendoza",
    "iniciales": "CM",
    "rol": "Revisor",
    "gerencia": "Gerencia Técnica",
    "redirect": "dashboard-revisor.html"
  },
  {
    "id": "enl-com-cg",
    "email": "enlace.cg.comercial@comapa.mx",
    "nombre": "Sandra Vega",
    "iniciales": "SV",
    "rol": "Enlace",
    "gerencia": "Gerencia Comercial",
    "unidadResponsable": "Coordinación General Comercial"
  },
  {
    "id": "enl-tec-cg",
    "email": "enlace.cg.tecnica@comapa.mx",
    "nombre": "Ricardo Morales",
    "iniciales": "RM",
    "rol": "Enlace",
    "gerencia": "Gerencia Técnica",
    "unidadResponsable": "Coordinación General Técnica"
  },
  {
    "id": "enl-adm-cg",
    "email": "enlace.cg.admin@comapa.mx",
    "nombre": "Verónica Ruiz",
    "iniciales": "VR",
    "rol": "Enlace",
    "gerencia": "Gerencia Administrativa",
    "unidadResponsable": "Coordinación General Administrativa"
  },
  {
    "id": "enl-pla-cg",
    "email": "enlace.cg.planeacion@comapa.mx",
    "nombre": "Sofía Castillo",
    "iniciales": "SC",
    "rol": "Enlace",
    "gerencia": "Gerencia de Planeación Estratégica",
    "unidadResponsable": "Coordinación General de Planeación Estratégica"
  },
  {
    "id": "enl-com-001",
    "email": "enlace@comapa.mx",
    "nombre": "Ana Torres",
    "iniciales": "AT",
    "rol": "Enlace",
    "gerencia": "Gerencia Comercial"
  },
  {
    "id": "enl-tec-001",
    "email": "enlace.tecnica@comapa.mx",
    "nombre": "Jorge Reyes",
    "iniciales": "JR",
    "rol": "Enlace",
    "gerencia": "Gerencia Técnica"
  },
  {
    "id": "enl-adm-001",
    "email": "enlace.admin@comapa.mx",
    "nombre": "María López",
    "iniciales": "ML",
    "rol": "Enlace",
    "gerencia": "Gerencia Administrativa"
  },
  {
    "id": "enl-pla-001",
    "email": "enlace.planeacion@comapa.mx",
    "nombre": "Marco Gutiérrez",
    "iniciales": "MG",
    "rol": "Enlace",
    "gerencia": "Gerencia de Planeación Estratégica"
  },
  {
    "id": "enl-gen-001",
    "email": "enlace.general@comapa.mx",
    "nombre": "Ana Torres",
    "iniciales": "AT",
    "rol": "Enlace",
    "gerencia": "Gerencia General",
    "unidadResponsable": "Gerencia General"
  },
  {
    "id": "enl-com-fac",
    "email": "enlace.facturacion@comapa.mx",
    "nombre": "Roberto Sánchez",
    "iniciales": "RS",
    "rol": "Enlace",
    "gerencia": "Gerencia Comercial",
    "unidadResponsable": "Coordinación de Facturación y Medición"
  },
  {
    "id": "enl-com-rez",
    "email": "enlace.rezago@comapa.mx",
    "nombre": "Patricia Vidal",
    "iniciales": "PV",
    "rol": "Enlace",
    "gerencia": "Gerencia Comercial",
    "unidadResponsable": "Coordinación de Control de Rezago"
  },
  {
    "id": "enl-com-usu",
    "email": "enlace.usuarios@comapa.mx",
    "nombre": "Diana Flores",
    "iniciales": "DF",
    "rol": "Enlace",
    "gerencia": "Gerencia Comercial",
    "unidadResponsable": "Coordinación de Atención a Usuarios"
  },
  {
    "id": "enl-com-pad",
    "email": "enlace.padron@comapa.mx",
    "nombre": "Ramón Ávila",
    "iniciales": "RA",
    "rol": "Enlace",
    "gerencia": "Gerencia Comercial",
    "unidadResponsable": "Coordinación de Padrón y Censo"
  },
  {
    "id": "enl-com-ind",
    "email": "enlace.industria@comapa.mx",
    "nombre": "Verónica Salas",
    "iniciales": "VS",
    "rol": "Enlace",
    "gerencia": "Gerencia Comercial",
    "unidadResponsable": "Coordinación de Atención a la Industria y Comercio"
  },
  {
    "id": "enl-com-acc",
    "email": "enlace.accesible@comapa.mx",
    "nombre": "Norma Ibáñez",
    "iniciales": "NI",
    "rol": "Enlace",
    "gerencia": "Gerencia Comercial",
    "unidadResponsable": "Coordinación Módulo de Atención Accesible"
  },
  {
    "id": "enl-tec-red",
    "email": "enlace.redes@comapa.mx",
    "nombre": "Eduardo Herrera",
    "iniciales": "EH",
    "rol": "Enlace",
    "gerencia": "Gerencia Técnica",
    "unidadResponsable": "Coordinación de Distribución y Mantenimiento de Redes"
  },
  {
    "id": "enl-tec-pry",
    "email": "enlace.proyectos@comapa.mx",
    "nombre": "Luis Ramírez",
    "iniciales": "LR",
    "rol": "Enlace",
    "gerencia": "Gerencia Técnica",
    "unidadResponsable": "Coordinación de Proyectos y Construcción"
  },
  {
    "id": "enl-tec-pot",
    "email": "enlace.potabilizadoras@comapa.mx",
    "nombre": "Gabriela Torres",
    "iniciales": "GT",
    "rol": "Enlace",
    "gerencia": "Gerencia Técnica",
    "unidadResponsable": "Coordinación de Plantas Potabilizadoras y Cárcamos"
  },
  {
    "id": "enl-tec-esp",
    "email": "enlace.especiales@comapa.mx",
    "nombre": "Humberto Nava",
    "iniciales": "HN",
    "rol": "Enlace",
    "gerencia": "Gerencia Técnica",
    "unidadResponsable": "Coordinación de Proyectos Especiales"
  },
  {
    "id": "enl-adm-rh",
    "email": "enlace.rh@comapa.mx",
    "nombre": "Claudia Moreno",
    "iniciales": "CM2",
    "rol": "Enlace",
    "gerencia": "Gerencia Administrativa",
    "unidadResponsable": "Coordinación de Recursos Humanos"
  },
  {
    "id": "enl-adm-fin",
    "email": "enlace.finanzas@comapa.mx",
    "nombre": "Fernando Castro",
    "iniciales": "FC",
    "rol": "Enlace",
    "gerencia": "Gerencia Administrativa",
    "unidadResponsable": "Coordinación de Finanzas"
  },
  {
    "id": "enl-adm-inf",
    "email": "enlace.informatica@comapa.mx",
    "nombre": "Beatriz Ríos",
    "iniciales": "BR",
    "rol": "Enlace",
    "gerencia": "Gerencia Administrativa",
    "unidadResponsable": "Coordinación de Informática"
  },
  {
    "id": "enl-adm-jur",
    "email": "enlace.juridica@comapa.mx",
    "nombre": "Alejandro Medina",
    "iniciales": "AM",
    "rol": "Enlace",
    "gerencia": "Gerencia Administrativa",
    "unidadResponsable": "Coordinación Jurídica"
  },
  {
    "id": "enl-adm-adq",
    "email": "enlace.adquisiciones@comapa.mx",
    "nombre": "Carmen Valdez",
    "iniciales": "CV",
    "rol": "Enlace",
    "gerencia": "Gerencia Administrativa",
    "unidadResponsable": "Coordinación de Adquisiciones"
  },
  {
    "id": "enl-adm-con",
    "email": "enlace.contabilidad@comapa.mx",
    "nombre": "Ernesto Lozano",
    "iniciales": "EL",
    "rol": "Enlace",
    "gerencia": "Gerencia Administrativa",
    "unidadResponsable": "Coordinación de Contabilidad"
  },
  {
    "id": "enl-adm-pol",
    "email": "enlace.politica@comapa.mx",
    "nombre": "Silvia Paredes",
    "iniciales": "SP",
    "rol": "Enlace",
    "gerencia": "Gerencia Administrativa",
    "unidadResponsable": "Coordinación de Política de Ingresos"
  },
  {
    "id": "enl-adm-ssh",
    "email": "enlace.seguridad@comapa.mx",
    "nombre": "Gustavo Núñez",
    "iniciales": "GN",
    "rol": "Enlace",
    "gerencia": "Gerencia Administrativa",
    "unidadResponsable": "Coordinación de Seguridad, Salud e Higiene"
  },
  {
    "id": "enl-adm-srv",
    "email": "enlace.servicios@comapa.mx",
    "nombre": "Lorena Espinoza",
    "iniciales": "LE",
    "rol": "Enlace",
    "gerencia": "Gerencia Administrativa",
    "unidadResponsable": "Coordinación de Servicios Generales"
  },
  {
    "id": "enl-adm-vin",
    "email": "enlace.vinculacion@comapa.mx",
    "nombre": "Marisol Delgado",
    "iniciales": "MD",
    "rol": "Enlace",
    "gerencia": "Gerencia Administrativa",
    "unidadResponsable": "Coordinación de Vinculación Social"
  },
  {
    "id": "enl-pla-est",
    "email": "enlace.estrategia@comapa.mx",
    "nombre": "Isabel Guerrero",
    "iniciales": "IG",
    "rol": "Enlace",
    "gerencia": "Gerencia de Planeación Estratégica",
    "unidadResponsable": "Coordinación de Proyectos Estratégicos"
  },
  {
    "id": "enl-pla-seg",
    "email": "enlace.seguimiento@comapa.mx",
    "nombre": "Andrés Peña",
    "iniciales": "AP",
    "rol": "Enlace",
    "gerencia": "Gerencia de Planeación Estratégica",
    "unidadResponsable": "Coordinación de Seguimiento a Plantas de Tratamiento"
  },
  {
    "id": "enl-pla-mc",
    "email": "enlace.mejora@comapa.mx",
    "nombre": "Rocío Fuentes",
    "iniciales": "RF",
    "rol": "Enlace",
    "gerencia": "Gerencia de Planeación Estratégica",
    "unidadResponsable": "Departamento de Mejora Continua y Calidad"
  },
  {
    "id": "enl-pla-dsp",
    "email": "enlace.deptoseguimiento@comapa.mx",
    "nombre": "Héctor Villanueva",
    "iniciales": "HV",
    "rol": "Enlace",
    "gerencia": "Gerencia de Planeación Estratégica",
    "unidadResponsable": "Departamento de Seguimiento a Plantas de Tratamiento"
  }
];
