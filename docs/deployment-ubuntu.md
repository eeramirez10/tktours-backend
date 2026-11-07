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

Completa al menos `DATABASE_URL`, `ADMIN_JWT_SECRET`, `PUBLIC_BASE_URL`, `CORS_ORIGIN`, `OPENAI_API_KEY` y las credenciales de Meta WhatsApp Cloud API.

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

La migración `20261108000000_restore_accommodation_reference_types` restaura los tres
identificadores de preferencias de alojamiento si faltan. Conserva los IDs, nombres y estados
ya existentes. No añade reglas de disponibilidad a programas ni confirma plazas o reservas.
El registro de una preferencia también recupera su referencia de forma idempotente para
evitar que respuestas como “Residencia” interrumpan el concierge después de limpiar datos.

La migración `20261008180000_reconcile_concierge_family_keys` corrige las claves de familias
creadas con nombres en español: Cursos de Idiomas usa `LANGUAGE_COURSE`, Campamentos usa
`CAMP` y Tours / Circuitos por el mundo usa `SCHOOL_PROGRAM`. Conserva sus identificadores
y las asociaciones con programas, recursos y solicitudes. Si hay familias equivalentes,
reutiliza una fila y reasigna sus vínculos; las filas históricas restantes se conservan inactivas.
Las familias personalizadas, como Años escolares, no se reclasifican como circuitos.
Las nuevas familias del menú reciben estas claves automáticamente desde el catálogo.
Los PDF anteriores que ahora pertenecen a `CAMP` deben tener sus temporadas, edición y
vigencia para compartir revisadas en Recursos > Editar. Tener el archivo almacenado o el
texto extraído no significa que sea elegible para el concierge. La reconciliación de claves
no inventa estos datos ni crea reglas de alojamiento a partir del PDF.
Si faltan alojamientos configurados, el concierge solicita confirmación por un asesor;
no debe preguntar por opciones inexistentes ni afirmar por eso que no hay folletos.
El saludo consulta `list_available_course_types` y muestra únicamente los tipos del menú
con programas activos en destinos activos o folletos vigentes disponibles. Una familia vacía
no se ofrece. Los números se interpretan según el último menú mostrado, no según posiciones
fijas. Si una oferta deja de existir, se explican las alternativas reales sin pedir datos de
calificación ni prometer documentos inexistentes. Tener un programa no promete tener un PDF.
Si falta una familia del menú tras limpiar datos, la solicitud la recupera sin crear programas
ni folletos ficticios. No se requiere un reset de la base de datos.

El servicio `migrate` ejecuta exclusivamente `prisma migrate deploy`:

```bash
docker compose --profile migrate run --rm migrate
```

No ejecuta `migrate dev` ni hace reset de la base de datos. Ejecútalo antes de cada despliegue que incluya migraciones.

### Temporadas propias de los folletos

La migración `20261002160000_add_resource_seasons` agrega `Resource.seasonKeys` sin borrar registros ni archivos.
Si un programa de campamentos tenía una sola temporada, se conserva para sus folletos existentes.
Si tenía varias, los folletos quedan pendientes de clasificación: en Recursos > Editar selecciona
las temporadas cubiertas por cada PDF (verano, Semana Santa o invierno).
El concierge no ofrece folletos de campamentos sin temporada propia.

Las temporadas ya no se capturan al crear o editar programas. El catálogo muestra badges
calculados desde sus folletos PDF vigentes con versión actual; sin folletos vigentes no anuncia
temporadas. Crear un programa de campamentos no requiere tener un PDF previamente.
La IA sugiere únicamente las temporadas explícitas del documento y el usuario confirma o
ajusta la selección al guardar el recurso. Si no detecta ninguna, se seleccionan manualmente.
Las ventanas históricas de programas se conservan en la base, pero no definen la oferta de
campamentos ni sustituyen las fechas y temporadas propias de los folletos. Esta simplificación
no requiere una nueva migración, reset ni eliminación de datos o archivos.

Puede haber varios folletos activos del mismo país y temporada; no se consideran duplicados
por ese motivo. El concierge considera los compatibles con el programa, ciudad, edad y fecha,
y comparte los de la temporada que confirme el cliente sin repetir un archivo multitemporada.

Antes de iniciar la nueva versión en producción, construye la imagen de migraciones y aplícala:

```bash
sudo docker compose build migrate
sudo docker compose --profile migrate run --rm migrate
```

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

### Vigencia y edición de los folletos

La migración `20261002180000_add_resource_sharing_validity` agrega `shareFrom` y
`shareUntil` sin borrar recursos ni archivos ni inventar vigencias para los PDFs existentes.

- `year`: edición/año del viaje, no la fecha de subida del archivo.
- `shareFrom` / `shareUntil`: periodo autorizado para ofrecer y compartir el PDF/precios.
- `validFrom` / `validUntil`: periodo del viaje. El mes solicitado se compara por solapamiento.
- Los campamentos sin edición o sin ambas fechas de envío quedan pendientes de configurar.
- Las tools y el envío de WhatsApp excluyen documentos vencidos, inactivos y ediciones anteriores.
- Un folleto del próximo verano puede compartirse ahora si su vigencia comercial ya comenzó.
- Los manuales realmente atemporales pueden dejar el año y las fechas vacíos.

Después del despliegue, editar los campamentos existentes en Recursos para completar su
año y vigencia de envío. No se requiere un reset de la base de datos ni eliminar el volumen.
La vigencia se calcula al consultar y antes de enviar usando el día de Ciudad de México;
no depende de un cron ni de cambiar manualmente el campo `active`.

Construir la imagen de migración actualizada antes de ejecutarla:

```bash
sudo docker compose build migrate tktours-concierge-backend
sudo docker compose --profile migrate run --rm migrate
sudo docker compose up -d --force-recreate tktours-concierge-backend
```

Después de que los cambios estén fusionados y enviados a `main`:

```bash
git pull --ff-only origin main
docker compose build --pull migrate tktours-concierge-backend
docker compose --profile migrate run --rm migrate
docker compose up -d --force-recreate tktours-concierge-backend
docker compose logs --tail=100 tktours-concierge-backend
```
