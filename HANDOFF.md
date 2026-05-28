# HANDOFF

## Proyecto

- **Nombre:** `tktours-concierge-backend-v2`
- **Objetivo:** backend v2 del concierge de TKTours/LUZ para calificar leads, recomendar programas y enviar resources/cotizaciones correctas.

## Qué hace el sistema

- guarda conversaciones y mensajes
- guarda inquiries con datos de calificación
- expone catálogo de programas con reglas
- administra resources por país/familia/programa
- ejecuta turns de IA con tools y trazabilidad

## Contexto clave de negocio

- No inventar programas, precios, PDFs ni reglas.
- La IA debe usar catálogo + resources + inquiry.
- El flujo no debe bloquearse si faltan respuestas del lead.
- Luz necesita subir links/recursos actualizados por país y tipo de programa.

## Programas foco

- campamentos
- cursos de idiomas
- programas escolares

## Reglas importantes ya detectadas

- campamentos: aprox. 7 a 18 años
- language courses: desde aprox. 15 años
- alojamiento depende de edad/programa
- fechas dependen de temporada o tipo de programa
- cotizaciones cambian mes a mes

## Archivos que debes leer primero

1. `README.md`
2. `docs/project-context-luz.md`
3. `prisma/schema.prisma`
4. `src/features/concierge`
5. `src/features/resources`

## Estado actual

Ya existe:

- catálogo base
- resources CRUD con versionado
- conversations/messages
- inquiries
- recomendaciones por reglas
- concierge con tools
- tracing de turns/tool calls

## Huecos importantes

- pricing/cotización más detallada
- multi-país más completo
- ingestión real de materiales desde drive
- extracción/RAG documental
- auth/admin hardening
- tests

## Si vas a continuar mañana

Empieza por validar:

- qué resources y links reales ya entregó Luz
- si ya existen countries/programs más allá de Canadá
- si el siguiente paso es pricing, RAG o integración inbound con WhatsApp

## Nota

Este proyecto no es un chatbot genérico. Es una base operativa para ventas/calificación asistida de programas educativos de TKTours.
