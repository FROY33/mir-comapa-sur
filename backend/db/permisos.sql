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

GRANT SELECT                         ON schema_migrations, gerencias, unidades, indicadores TO :"app";
-- Los triggers de reportes leen la versión del indicador al generar un reporte (R3-01); los medios
-- se leen con el indicador. Escribir versiones solo lo hace el trigger de INDICADORES (dueño).
GRANT SELECT                         ON indicador_versiones, medios_verificacion TO :"app";
-- ciclos_planeacion, metas_planeacion y metas_periodo: sin permisos hasta que el código de R4 los use.
GRANT SELECT, UPDATE                 ON frecuencias      TO :"app";   -- ventanas de captura (R3-01)
GRANT SELECT, INSERT, UPDATE         ON usuarios         TO :"app";   -- gestión de usuarios (R7-07); nunca DELETE (RN_3)
GRANT SELECT, INSERT, UPDATE         ON sesiones         TO :"app";   -- se revocan, no se borran
GRANT SELECT, INSERT, UPDATE, DELETE ON login_intentos   TO :"app";   -- el contador se borra al entrar bien (R7-06)
GRANT SELECT, INSERT                 ON periodos_reporte TO :"app";   -- apertura de ciclos (R3-01)
GRANT SELECT, INSERT                 ON reportes         TO :"app";   -- generación de reportes (R3-01)
GRANT SELECT, INSERT                 ON bitacora         TO :"app";   -- solo inserción (TEC-05 CA-5)
