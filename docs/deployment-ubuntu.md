# Despliegue con Docker en Ubuntu

## Preparación inicial

1. Instala Docker Engine y Docker Compose Plugin en el servidor.
2. Clona el repositorio y cambia a `main`.
3. Crea una vez el volumen externo que persistirá los PDFs:

```bash
docker volume create tktours-concierge-resources
```

4. Crea el archivo de variables sin versionarlo:

```bash
cp deploy/.env.production.example .env
chmod 600 .env
```

Completa al menos `DATABASE_URL`, `ADMIN_JWT_SECRET`, `PUBLIC_BASE_URL`, `CORS_ORIGIN`, `OPENAI_API_KEY` y las credenciales de Twilio.

Usa el formato estricto `CLAVE=valor`, sin espacios alrededor de `=`. Docker Compose no acepta el formato flexible que tolera `dotenv`.

## Primera ejecución

Aplica las migraciones antes de levantar la API y luego construye e inicia el servicio:

```bash
docker compose --profile migrate run --rm migrate
docker compose build --pull tktours-concierge-backend
docker compose up -d tktours-concierge-backend
docker compose ps
curl http://127.0.0.1:4001/health
```

Los archivos se guardan en el volumen `tktours-concierge-resources`, independiente del contenedor y del proyecto Compose. Respáldalo junto con la base de datos.

## Migraciones Prisma

El servicio `migrate` ejecuta exclusivamente `prisma migrate deploy`:

```bash
docker compose --profile migrate run --rm migrate
```

No ejecuta `migrate dev` ni hace reset de la base de datos. Ejecútalo antes de cada despliegue que incluya migraciones.

### Recuperar una migración parcial

Si la base ya tenía cambios de catálogo o ubicaciones y falló `20260820120000_sync_production_schema`, primero actualiza el código que incluye la migración de reconciliación. Después marca esa migración fallida como aplicada y ejecuta el despliegue normal:

```bash
docker compose --profile migrate run --rm migrate \
  pnpm exec prisma migrate resolve --applied 20260820120000_sync_production_schema
docker compose --profile migrate run --rm migrate
```

Este procedimiento es específico para esa migración. No uses `migrate resolve --applied` de forma general para omitir migraciones.

## Crear o cambiar el administrador inicial

El script recibe la contraseña solo como variable temporal del shell. No la agregues al `.env` ni a variables `VITE_*` del frontend:

```bash
ADMIN_PASSWORD='cambia-esta-contrasena' \
  docker compose run --rm --no-deps -e ADMIN_PASSWORD tktours-concierge-backend \
  node dist/src/scripts/createAdminUser.js \
  --name Luz --email luz@tktours.com --role ADMIN
```

Ejecutarlo de nuevo para el mismo correo actualiza nombre, rol y contraseña.

## Actualizaciones

Después de que los cambios estén fusionados y enviados a `main`:

```bash
git pull --ff-only origin main
docker compose --profile migrate run --rm migrate
docker compose build --pull tktours-concierge-backend
docker compose up -d --force-recreate tktours-concierge-backend
docker compose logs --tail=100 tktours-concierge-backend
```
