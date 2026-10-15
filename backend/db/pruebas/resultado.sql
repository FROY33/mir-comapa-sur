-- Cierre común: imprime los resultados y revierte todo.

\o
SELECT '  ✓ ' || descripcion FROM _resultados ORDER BY n;
SELECT '';
SELECT '  ' || count(*) || ' pruebas pasaron' FROM _resultados;

ROLLBACK;
