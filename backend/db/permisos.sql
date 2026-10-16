-- Permisos mínimos del usuario de base con el que corre la aplicación (producción).
--
--   psql "$DATABASE_URL_DUEÑO" -v app=comapa_app -f db/permisos.sql
--
-- El rol `app` lo crea antes el administrador de la base, con LOGIN y su contraseña; este archivo
-- solo le da permisos. Las migraciones y la carga inicial (db/sembrar.sh) corren con el dueño de las
-- tablas, nunca con este rol.
--
-- Por qué importa: el dueño de una tabla puede desactivar sus triggers, borrarla o vaciarla. Si la
-- app se conectara como dueño, un error o una inyección podría borrar la bitácora (TEC-05 CA-5)
-- o reabrir un reporte cerrado saltándose sus triggers. Con este rol no puede.
--
-- Cada permiso corresponde a lo que el código hace hoy. Una HU que necesite más (p. ej. UPDATE
-- en reportes para capturar avance, R1-02) lo agrega aquí, con su prueba en pruebas/permisos.test.ts.

-- En PostgreSQL 14 cualquier rol puede crear tablas en `public` (cambió hasta la 15). Se quita a
-- todos y se deja solo al rol que corre este archivo, que es el de las migraciones.
GRANT CREATE ON SCHEMA public TO CURRENT_USER;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"app";
GRANT USAGE ON SCHEMA public TO :"app";

GRANT SELECT                         ON schema_migrations, gerencias, unidades TO :"app";
GRANT SELECT, INSERT, UPDATE         ON indicadores      TO :"app";   -- catálogo del Admin (HU-R4-11); nunca DELETE (RN_2)
-- Los triggers de reportes leen la versión del indicador al generar un reporte (R3-01). Escribir
-- versiones solo lo hace el trigger de INDICADORES (dueño); medios_verificacion va aparte abajo
-- porque esa sí la escribe la app (mantenimiento del catálogo, S2-TEC-03).
GRANT SELECT                         ON indicador_versiones TO :"app";
-- Catálogo de medios de verificación (S2-TEC-03, ticket 4): alta, renombre y desactivación por el
-- Administrador, con su propia bitácora; nunca DELETE (nada se borra, CA-3)
GRANT SELECT, INSERT, UPDATE         ON medios_verificacion TO :"app";
GRANT SELECT, UPDATE                 ON frecuencias      TO :"app";   -- ventanas de captura (R3-01)
GRANT SELECT, INSERT, UPDATE         ON usuarios         TO :"app";   -- gestión de usuarios (R7-07); nunca DELETE (RN_3)
GRANT SELECT, INSERT, UPDATE         ON sesiones         TO :"app";   -- se revocan, no se borran
GRANT SELECT, INSERT, UPDATE, DELETE ON login_intentos   TO :"app";   -- el contador se borra al entrar bien (R7-06)
GRANT SELECT, INSERT                 ON periodos_reporte TO :"app";   -- apertura de ciclos (R3-01)
GRANT SELECT, INSERT                 ON reportes         TO :"app";   -- generación de reportes (R3-01)
GRANT SELECT, INSERT                 ON bitacora         TO :"app";   -- solo inserción (TEC-05 CA-5)
-- Catálogo administrable (HU-R4-11): lee metas para decidir la vigencia futura (CA_4) y calcular el cumplimiento (RN_3)
GRANT SELECT                         ON ciclos_planeacion, metas_planeacion, metas_periodo TO :"app";
-- Planeación de metas (PRD0_1, R4-01 y R4-02): la app abre el ciclo (INSERT) y genera y avanza las metas
-- (INSERT/UPDATE; la marca vencida, el borrador). Nunca DELETE: las metas se versionan, no se borran, y
-- una versión histórica no se modifica (trigger). Cerrar un ciclo (UPDATE) y escribir metas_periodo
-- se agregan con R4-04/R4-05, junto con su prueba.
GRANT INSERT                         ON ciclos_planeacion TO :"app";
GRANT INSERT, UPDATE                 ON metas_planeacion  TO :"app";
-- Cambios del indicador con vigencia futura (HU-R4-11 CA_4): se programan, se aplican o cancelan (UPDATE); nunca DELETE
GRANT SELECT, INSERT, UPDATE         ON indicador_cambios_programados TO :"app";
