# tktours-concierge-backend-v2

[![CI](https://github.com/<OWNER>/<REPO>/actions/workflows/ci.yml/badge.svg)](https://github.com/<OWNER>/<REPO>/actions/workflows/ci.yml)

Backend v2 para el concierge/assistant de TKTours enfocado en calificación de leads, catálogo de programas, administración de resources y orquestación de IA para recomendaciones y envío de información.

## Qué es este proyecto

Este proyecto busca convertir el proceso manual de atención y cotización de TKTours en un sistema asistido por IA que pueda:

- recibir leads
- hacer preguntas de calificación
- entender tipo de programa, país, edad, alojamiento y fechas
- recomendar programas válidos
- enviar resources/cotizaciones correctas
- guardar conversación e inquiry
- dar trazabilidad de lo que respondió la IA

La fuente de verdad no debe ser memoria libre del modelo. La IA debe trabajar sobre:

- catálogo estructurado
- reglas de negocio
- resources administrables
- inquiry persistido
- conversación persistida

## Contexto de negocio

El proyecto nace para soportar el trabajo de Luz / TKTours con programas educativos como:

- campamentos
- cursos de idiomas
- programas escolares

Hay detalles de negocio importantes:

- campamentos suelen aplicar a edades de 7 a 18 años
- cursos de idiomas arrancan desde ~15 años
- el alojamiento puede depender de la edad
- las fechas de inicio dependen de temporada o del tipo de programa
- las cotizaciones cambian mes a mes
- la IA no debe inventar programas, reglas, precios ni materiales

### Documento clave

Para contexto de producto y resumen de la reunión con Luz:

- `docs/project-context-luz.md`

Ese archivo está pensado para que otro asistente o desarrollador entienda rápido de qué va el sistema y qué acuerdos de negocio ya existen.

## Stack

- **Node.js**
- **TypeScript**
- **Express**
- **Prisma**
- **PostgreSQL**
- **OpenAI Responses API**
- **Zod**
- **Pino**

## Despliegue Docker

La configuración de producción con Docker Compose, volumen persistente para PDFs y procedimiento de Ubuntu está en [docs/deployment-ubuntu.md](docs/deployment-ubuntu.md).

## Estado actual

Actualmente el backend ya cuenta con:

- API HTTP con Express
- schema Prisma con dominio principal del concierge
- seed base para catálogo inicial de Canadá
- CRUD de resources con versionado
- conversaciones y mensajes persistidos
- inquiries persistidos
- recomendación de programas basada en reglas
- orquestador de IA con tools
- trazabilidad de turns y tool calls del concierge

## Módulos principales

### 1. Catalog
Responsable de:

- países
- familias de producto
- programas
- reglas de programa
- accommodations
- ventanas de inicio
- recomendaciones basadas en filtros de negocio

### 2. Resources
Responsable de:

- metadata de resources
- versionado
- uploads locales
- links externos
- activación/desactivación
- download de archivos locales

Este módulo es clave porque Luz necesita subir y mantener cotizaciones y materiales actualizados por país/programa.

### 3. Conversations
Responsable de:

- crear conversaciones
- persistir mensajes
- guardar estado/stage de la conversación
- soportar flujo tipo hilo conversacional por lead

### 4. Inquiries
Responsable de:

- guardar datos de calificación del lead
- estado del inquiry
- país, familia, programa, edad, alojamiento, semanas, fechas, etc.
- refrescar recomendaciones según datos ya detectados

### 5. Concierge
Responsable de:

- ejecutar un turno del assistant
- construir contexto para el modelo
- llamar tools
- validar respuesta estructurada
- persistir respuesta de salida
- guardar trazas de cada turno y tool call

## Arquitectura general

El proyecto está organizado por features:

- `src/features/catalog`
- `src/features/resources`
- `src/features/conversations`
- `src/features/inquiries`
- `src/features/concierge`
- `src/shared`

Cada feature sigue una separación aproximada en:

- `application`
- `domain`
- `infrastructure`
- `presentation`

## Dominio principal

El schema actual incluye entidades como:

- `Country`
- `ProductFamily`
- `Program`
- `ProgramRule`
- `AccommodationType`
- `ProgramAccommodationRule`
- `ProgramStartWindow`
- `Resource`
- `ResourceVersion`
- `ResourceExtraction`
- `ResourceChunk`
- `Contact`
- `Conversation`
- `Message`
- `Inquiry`
- `InquiryRecommendation`
- `InquiryResourceSend`
- `ConciergeTurn`
- `ConciergeToolCall`

## Endpoints principales

### Health
- `GET /health`

### Catalog
- `GET /api/catalog/health`
- `GET /api/catalog/reference/countries`
- `GET /api/catalog/reference/cities?countryCode=CA&search=montreal`
- `GET /api/catalog/countries`
- `POST /api/catalog/countries`
- `GET /api/catalog/families`
- `GET /api/catalog/locations`
- `POST /api/catalog/locations`
- `GET /api/catalog/programs`
- `GET /api/catalog/programs/:slug`
- `GET /api/catalog/programs/recommendations`

### Resources
- `GET /api/resources/health`
- `GET /api/resources`
- `GET /api/resources/:resourceId`
- `POST /api/resources`
- `POST /api/resources/analyze` (PDF nuevo, multipart)
- `POST /api/resources/:resourceId/analyze` (vuelve a analizar el PDF guardado, sin crear versión)
- `PATCH /api/resources/:resourceId`
- `PATCH /api/resources/:resourceId/active`
- `POST /api/resources/:resourceId/versions`
- `GET /api/resources/:resourceId/versions/:versionId/download`
- `DELETE /api/resources/:resourceId`

El flujo recomendado de alta y edición envía `countryCode`, `countryName` y `locationNames`. El backend reutiliza o crea el país y las ciudades dentro de la misma transacción del resource. `locationSlug` y `locationSlugs` se conservan temporalmente para compatibilidad con clientes anteriores.

Las rutas `catalog/reference/*` proporcionan sugerencias externas para los autocompletados. Las selecciones sólo se incorporan al catálogo local al guardar un resource; esa copia local continúa siendo la fuente de verdad del concierge.

### Conversations
- `GET /api/conversations/health`
- `GET /api/conversations`
- `GET /api/conversations/:conversationId`
- `POST /api/conversations`
- `PATCH /api/conversations/:conversationId`
- `POST /api/conversations/:conversationId/messages`

### Inquiries
- `GET /api/inquiries/health`
- `GET /api/inquiries`
- `GET /api/inquiries/:inquiryId`
- `POST /api/inquiries`
- `PATCH /api/inquiries/:inquiryId`
- `PATCH /api/inquiries/:inquiryId/status`
- `POST /api/inquiries/:inquiryId/recommendations/refresh`

### Concierge
- `GET /api/concierge/turns`
- `GET /api/concierge/turns/:turnId`
- `POST /api/concierge/run-turn`

### WhatsApp / Meta Cloud API
- `GET /webhooks/meta/whatsapp` (verificación)
- `POST /webhooks/meta/whatsapp` (eventos firmados)

## Tools del concierge

Hoy el assistant puede usar tools como:

- `find_matching_programs`
- `get_program_detail`
- `list_destination_overview`
- `list_available_resources`
- `search_resource_content`

Antes de generar la respuesta, la herramienta interna `interpret_message` interpreta el mensaje con salida estructurada estricta: recibe historial visible, solicitud, catálogo y menú mostrado. Valida país, familia, ciudad y programa; guarda datos y contacto antes de generar la respuesta. La ambigüedad produce una pregunta de aclaración. Los saludos conservan la solicitud; solo un reinicio explícito interpretado crea otra.

El modelo de respuesta consulta información confirmada; las modificaciones de la solicitud provienen de la interpretación validada. `previous_response_id` y los mensajes permanecen guardados. Solo un error explícito de referencia inexistente permite reconstruir la cadena desde el historial, dejando traza `context_recovery`; un timeout o error de red no borra la referencia.

## Seed inicial

El seed actual mete catálogo base para **Canadá**:

### Familias
- `CAMP`
- `LANGUAGE_COURSE`
- `SCHOOL_PROGRAM`

### Accommodations
- `HOST_FAMILY`
- `UNIVERSITY_RESIDENCE`
- `SHARED_APARTMENT`

### País
- `CA / Canada`

### Programas
- `canada-summer-camp`
- `canada-winter-camp`
- `canada-easter-camp`
- `canada-language-course`
- `canada-school-semester`
- `canada-school-year`
- `canada-school-mini-stay-group`

## Variables de entorno

Ejemplo en `.env.example`:

- `DATABASE_URL`
- `PORT`
- `LOG_LEVEL`
- `NODE_ENV`
- `RESOURCES_STORAGE_DIR`
- `PUBLIC_BASE_URL` (ej. `https://tu-dominio.ngrok-free.app`)
- `WHATSAPP_META_ACCESS_TOKEN`
- `WHATSAPP_META_PHONE_NUMBER_ID`
- `WHATSAPP_META_VERIFY_TOKEN`
- `WHATSAPP_META_APP_SECRET`
- `WHATSAPP_META_GRAPH_API_VERSION`

No subir secretos reales al repo.

## Pruebas con WhatsApp Cloud API

Flujo implementado para webhook inbound:

1. Meta envía eventos firmados a `POST /webhooks/meta/whatsapp`.
2. El backend verifica `X-Hub-Signature-256`, crea/recupera el contacto por `waId` y abre la conversación `WHATSAPP`.
3. Confirma en una transacción el mensaje inbound (deduplicado por `wamid`), la fecha de la conversación, la solicitud y un trabajo `WhatsAppInboundJob`. Publica el evento del panel inmediatamente después del commit. Solo entonces devuelve HTTP 200; una falla de persistencia devuelve error para que Meta reintente.
4. El worker del servidor procesa los trabajos persistidos en orden por conversación. La cola pendiente sobrevive al reinicio; los turnos del mismo proceso también se serializan entre instancias del orquestador.
5. Envía texto y PDFs por Cloud API y conserva los estados de entrega. Los fallos quedan registrados y los mensajes recibidos permanecen visibles. Una interrupción de un trabajo en curso se detecta por su lease y se marca para revisión; no se reenvía automáticamente un resultado de transporte incierto.

Aplica la migración `20261110120000_whatsapp_durable_inbox` antes de iniciar esta versión en otro entorno. La migración no reconstruye mensajes ni trabajos históricos ausentes. El historial de envíos sigue bloqueando reenvíos automáticos por solicitud y versión.

### Setup rápido

1. En `.env.development` configura el access token y `WHATSAPP_META_PHONE_NUMBER_ID` del número de prueba de Meta.
2. Levanta backend (`pnpm run dev`) y expónlo con un túnel HTTPS.
3. En Meta Developers configura callback URL `https://TU-DOMINIO/webhooks/meta/whatsapp` y el mismo `WHATSAPP_META_VERIFY_TOKEN`.
4. Suscribe el campo `messages` y manda un WhatsApp al número de prueba.
5. En producción usa esas mismas variables en `.env`, pero con el token y phone-number ID del número productivo.
6. Revisa trazas:
   - `GET /api/concierge/turns`
   - `GET /api/conversations`

Los adjuntos enviados por WhatsApp usan el título del recurso con la extensión del archivo. La versión se valida de nuevo antes del envío y sus identificadores y nombre quedan en los metadatos del mensaje; las URLs históricas siguen siendo compatibles.

Con edad, ciudad, mes y semanas capturados, el concierge presenta todos los recursos compatibles antes de pedir los datos de contacto. La estancia completa debe caber en las fechas registradas (semanas de siete días, último día inclusivo). No se infieren fechas ni duración ausentes, cupos o precios. La recomendación persistida se recalcula si cambian los criterios y no autoriza reenviar archivos ya entregados. Estos cambios no requieren migraciones.

## Verificación de recepción y continuidad

`pnpm test` ejecuta las pruebas deterministas con dobles de IA y transporte, incluidas las reglas de fechas, tarifas y archivos. La prueba de integración de la bandeja se omite salvo activación explícita.

Para comprobar transacciones, deduplicación y orden contra PostgreSQL desechable:

```bash
docker run --detach --rm --name tktours-inbox-test -e POSTGRES_PASSWORD=test-only -e POSTGRES_DB=tktours_test -p 127.0.0.1:55432:5432 postgres:17-alpine
DATABASE_URL=postgresql://postgres:test-only@127.0.0.1:55432/tktours_test pnpm exec prisma migrate deploy
DATABASE_URL=postgresql://postgres:test-only@127.0.0.1:55432/tktours_test pnpm test:inbox
docker stop tktours-inbox-test
```

La prueba de integración exige una URL local con base terminada en `_test`. No llama a Meta ni a OpenAI.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run test:memory-chain`
- `npm run prisma:generate`
- `npm run prisma:migrate`
- `npm run prisma:studio`
- `npm run prisma:validate`
- `npm run prisma:seed`

## CI

Existe workflow en `.github/workflows/ci.yml` que corre en `pull_request` y en `push` a `main`, y ejecuta:

1. `npm ci`
2. `npm run prisma:generate`
3. `npx prisma migrate deploy`
4. `npm run build`
5. `npm run test:memory-chain`

Para que el badge funcione en GitHub, reemplaza `<OWNER>/<REPO>` en la línea del badge por el namespace real del repositorio.

## Cómo correr el proyecto

1. Instala dependencias.
2. Configura `DATABASE_URL` en tu entorno local.
3. Ejecuta migraciones.
4. Corre seed inicial.
5. Levanta el servidor.

Ejemplo:

```bash
npm install
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

## Storage de resources

Por default los uploads se guardan en:

- `./storage/resources`

Se puede cambiar con:

- `RESOURCES_STORAGE_DIR`

Los resources pueden ser:

- archivo subido
- link externo

## Datos confirmados del recurso

El concierge consulta los campos guardados del formulario. `search_resource_content` conserva su nombre por compatibilidad, pero devuelve esos campos; no consulta fragmentos ni reinterpreta PDFs durante el chat. El análisis con IA devuelve sugerencias que el administrador revisa antes de guardar. El botón **Analizar otra vez con IA** permite analizar el PDF actual sin volver a cargarlo.

Cada recurso conserva `minWeeks`, `maxWeeks` y `tariffs`. Los campos vacíos quedan sin confirmar; no heredan semanas de `ProgramRule`. Cada tarifa contiene `kind` (`PACKAGE` o `EXTRA_WEEK`), `weeks` (duración del paquete; null para semana adicional), `modality`, `amount`, `currency` y `notes`. Un paquete tiene precio propio: no se calcula sumando semanas adicionales a `priceFrom`. Las APIs JSON reciben una lista; el upload multipart recibe `tariffs` como JSON.

`validFrom`/`validUntil` son fechas del viaje; `shareFrom`/`shareUntil` autorizan la publicación. Se valida el mes solicitado aun sin año. El envío se reserva en `InquiryResourceSend` por solicitud y versión mediante una clave única; un cambio de mes o un reinicio no reenvía el archivo. Solo otra petición explícita o un fallo comprobado habilita un reintento. Un resultado de transporte desconocido permanece bloqueado para evitar duplicados.

La migración `20261109000000_resource_confirmed_facts` agrega campos sin copiar duraciones compartidas ni modificar conversaciones, contactos o archivos. Corrige solamente el inicio de publicación de CAD BLI 2027. Antes de publicar, aplica la migración con `prisma migrate deploy`, despliega el backend y después el panel. Los folletos existentes requieren confirmar su duración y tarifas en Recursos.

Verificación local del backend:

```sh
pnpm build
NODE_ENV=test node --env-file=.env.development --import tsx --test 'src/**/*.test.ts'
```

La integración `src/scripts/verifyResourceSourceOfTruth.ts` está restringida a PostgreSQL local con una base desechable llamada `resources_test`. Aplica primero las migraciones anteriores a `20261109000000_resource_confirmed_facts`, carga `src/scripts/fixtures/resource-source-of-truth-before-migration.sql`, aplica la migración nueva y ejecuta el script con `DATABASE_URL` apuntando a esa base. Comprueba conservación de datos, duración independiente, Montreal/Quebec, enero sin año y envíos concurrentes con reintentos controlados. No utiliza ni modifica datos reales.

## Decisiones importantes del proyecto

- La IA no debe hardcodear programas ni PDFs.
- La IA debe apoyarse en catálogo y resources.
- El sistema debe tolerar información incompleta del lead.
- El flujo no debe bloquearse si el usuario no responde todo.
- Luz necesita una manera simple de mantener cotizaciones y materiales por país/programa.
- El backend debe servir como base para integración futura con pricing más robusto y procesamiento documental.

## Pendientes importantes

Aunque la base ya está avanzada, todavía hay áreas por fortalecer:

- pricing/cotización más detallada
- soporte multi-país más completo
- ingestión real de materiales desde drive/fuentes externas
- extracción/chunking/retrieval de documentos
- autenticación/autorización de admin
- tests automatizados
- integración completa con canal WhatsApp si aún no está cableada fuera de este repo

## Notas para otro asistente o desarrollador

Si retomas este proyecto mañana, empieza por esto:

1. lee `docs/project-context-luz.md`
2. revisa `prisma/schema.prisma`
3. revisa `src/features/concierge`
4. revisa `src/features/resources`
5. entiende que el objetivo principal es calificar leads y mandar recursos/cotizaciones correctas, no solo responder chat
