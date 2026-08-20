# Despliegue con Docker en Ubuntu

## Preparación inicial

1. Instala Docker Engine y Docker Compose Plugin en el servidor.
2. Clona el repositorio y cambia a `main`.
3. Crea el directorio persistente para los PDFs. El contenedor usa el UID/GID `10001`:

```bash
sudo install -d -o 10001 -g 10001 -m 750 /srv/tktours/resources
```

4. Crea el archivo de variables sin versionarlo:

```bash
cp deploy/.env.production.example .env
chmod 600 .env
```

Completa al menos `DATABASE_URL`, `ADMIN_JWT_SECRET`, `PUBLIC_BASE_URL`, `CORS_ORIGIN`, `OPENAI_API_KEY` y las credenciales de Twilio. `RESOURCES_HOST_DIR` debe conservar `/srv/tktours/resources` salvo que el volumen se monte en otro lugar.

Usa el formato estricto `CLAVE=valor`, sin espacios alrededor de `=`. Docker Compose no acepta el formato flexible que tolera `dotenv`.

## Primera ejecución

Construye y levanta la API:

```bash
docker compose build --pull api
docker compose up -d api
docker compose ps
curl http://127.0.0.1:4001/health
```

Los archivos se guardan fuera del contenedor, en `/srv/tktours/resources`. Respáldalos junto con la base de datos.

## Migraciones Prisma

El servicio `migrate` ejecuta exclusivamente `prisma migrate deploy`:

```bash
docker compose --profile migrate run --rm migrate
```

No ejecuta `migrate dev` ni hace reset de la base de datos. Actualmente la rama de Neon tiene migraciones aplicadas que no existen en este repositorio; recupera o reconcilia ese historial antes de ejecutar este comando. La API puede iniciarse mientras el esquema remoto ya sea compatible.

## Crear o cambiar el administrador inicial

El script recibe la contraseña solo como variable temporal del shell. No la agregues al `.env` ni a variables `VITE_*` del frontend:

```bash
ADMIN_PASSWORD='cambia-esta-contrasena' \
  docker compose run --rm --no-deps -e ADMIN_PASSWORD api \
  node dist/src/scripts/createAdminUser.js \
  --name Luz --email luz@tktours.com --role ADMIN
```

Ejecutarlo de nuevo para el mismo correo actualiza nombre, rol y contraseña.

## Actualizaciones

Después de que los cambios estén fusionados y enviados a `main`:

```bash
git pull --ff-only origin main
docker compose build --pull api
# Ejecuta migrate solo después de reconciliar el historial de Prisma.
docker compose up -d --force-recreate api
docker compose logs --tail=100 api
```
