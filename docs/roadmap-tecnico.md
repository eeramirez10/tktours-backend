# Roadmap técnico

Este roadmap prioriza lo que más mueve el proyecto de LUZ/TKTours hacia un sistema útil en operación real.

## Prioridad 1 — Pricing / quote engine

### Objetivo
Poder generar o soportar cotizaciones más estructuradas, no solo matching de programa.

### Por qué va primero
Hoy el backend ya califica, recomienda y envía resources, pero el corazón del negocio es la cotización.

### Entregables sugeridos
- modelo de tarifas por país/programa/temporada
- soporte para duración (semanas/semestre/año)
- soporte para alojamiento
- soporte para extras relevantes
- estructura de quote resultante
- endpoint o service para construir cotización base

### Preguntas de negocio por cerrar
- ¿la cotización vive como link externo, cálculo interno o ambos?
- ¿qué componentes de precio son obligatorios?
- ¿qué tan variable es el pricing por escuela/proveedor?

## Prioridad 2 — Multi-país real

### Objetivo
Expandir el catálogo y resources más allá de Canadá.

### Países mencionados
- Canadá
- Estados Unidos
- Inglaterra
- Italia
- Francia
- Irlanda

### Entregables sugeridos
- seed/config inicial para países faltantes
- estrategia para cargar programas por país
- convenciones para slugs y resources por país
- validación de reglas por país y familia

## Prioridad 3 — Resources operables para Luz

### Objetivo
Dejar realmente usable la carga de materiales/cotizaciones por parte de Luz.

### Entregables sugeridos
- asegurar buen soporte para links externos
- campos/metadatos suficientes para mes/año/tipo/país/programa
- flujo simple para activar/desactivar resources
- convención clara para cotizaciones mensuales
- convención clara para materiales informativos sin precio

### Ideal
- definir contrato exacto para resources tipo `QUOTE`, `INFO`, `BROCHURE`, `MANUAL`, `PRESENTATION`

## Prioridad 4 — Ingesta documental y RAG

### Objetivo
Permitir que la IA consulte contenido actualizado de manuales, programas y materiales.

### Ya existe en schema
- `ResourceExtraction`
- `ResourceChunk`

### Falta
- parser de documentos
- limpieza de texto
- chunking
- embeddings o índice de búsqueda
- retrieval por contexto
- integración del retrieval en concierge

### Resultado esperado
La IA podría responder usando materiales reales sin improvisar.

## Prioridad 5 — Flujo end-to-end inbound

### Objetivo
Conectar el backend con el flujo real de entrada de leads y ejecución de turns.

### Entregables sugeridos
- webhook/capa inbound de WhatsApp
- creación automática de conversation/contact/message
- detección o creación de inquiry activo
- disparo del concierge turn
- persistencia de respuesta outbound
- trazabilidad completa del ciclo

## Prioridad 6 — UX operativa de admin

### Objetivo
Hacer que el sistema sea operable por humanos sin depender de ingeniería para cada cambio.

### Entregables sugeridos
- panel/admin para resources
- panel/admin para inquiries y conversations
- vista de trazas del concierge
- filtros por país, familia, status, stage y fecha

## Prioridad 7 — Seguridad y robustez

### Objetivo
Preparar el backend para uso más serio.

### Entregables sugeridos
- autenticación de admin
- autorización por roles
- validaciones adicionales
- rate limit
- mejores logs
- manejo de errores más fino
- políticas de storage más seguras

## Prioridad 8 — Tests

### Objetivo
Reducir regresiones al seguir iterando.

### Entregables sugeridos
- tests de use cases críticos
- tests de catálogo y reglas
- tests de inquiries/recommendations
- tests del concierge orchestrator con mocks
- tests de controllers principales

## Recomendación práctica de ejecución

Orden sugerido de trabajo:

1. pricing / quote engine
2. multi-país real
3. operabilidad de resources para Luz
4. ingesta documental / RAG
5. flujo inbound end-to-end
6. admin UX
7. seguridad
8. tests

## Quick wins

Si se necesita avanzar rápido para demo:

- cargar más países aunque sea con catálogo base simplificado
- dejar sólido el flujo de resources por links externos
- asegurar que concierge pregunte faltantes y recomiende sin trabarse
- preparar una demo con inquiries + recommendations + resources

## Criterio de éxito

El sistema empieza a ser realmente útil cuando puede:

1. recibir un lead
2. calificarlo parcialmente aunque falten datos
3. identificar programas válidos
4. mandar el recurso/cotización correcta
5. dejar trazabilidad clara para Luz/TKTours
