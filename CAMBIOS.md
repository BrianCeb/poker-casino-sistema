# Cambios implementados

## Funcionalidades
- Login básico con usuarios, contraseñas hasheadas con bcrypt y JWT.
- Roles: `direccion` y `caja`.
- Protección de endpoints sensibles.
- Dirección: listar jugadores y buscar por DNI/nombre/apellido.
- Dirección: editar jugador (DNI no editable desde la UI).
- Dirección: configurar torneo con nombre, fecha, buy-in y recompra.
- Caja: lee automáticamente el torneo activo.
- Caja: valida el monto configurado.
- Buy-in único por jugador y fecha, con índice único parcial de MongoDB y control ante concurrencia.
- Recompras ilimitadas después del buy-in.
- Dirección: exportar operaciones a CSV y Excel.
- Se mantiene el backup automático existente.

## Antes de ejecutar
1. En cada panel, copiar `.env.example` a `.env`.
2. Usar la misma `MONGODB_URI` en ambos.
3. Usar el mismo `JWT_SECRET` en ambos.
4. Definir `DIRECCION_USER`, `DIRECCION_PASSWORD`, `CAJA_USER`, `CAJA_PASSWORD`.
5. Ejecutar `npm install` en `panel-direccion` y `panel-caja`.
6. Arrancar Dirección y Caja por separado con `npm start`.

## Importante sobre datos existentes
El modelo de `Transaction` agrega un índice único parcial para impedir dos documentos `buyin` con el mismo `dni` y `fecha`. Si la base existente ya contiene duplicados de buy-in para una misma fecha/DNI, MongoDB puede no poder crear el índice automáticamente. Antes de producción hay que detectar y resolver esos duplicados.

## Seguridad
La clave anterior `DIRECCION_API_KEY` deja de ser necesaria. No se debe poner una contraseña real directamente en `renderer/index.html`.
El backend sigue escuchando en `127.0.0.1`, por lo que no expone el API directamente a la red local.

## Producción
Este login es una capa básica y apropiada para este esquema de aplicaciones de escritorio/locales, pero no reemplaza una arquitectura centralizada con HTTPS, sesiones revocables, auditoría y gestión de usuarios si el sistema se expone fuera de las PCs del casino.
