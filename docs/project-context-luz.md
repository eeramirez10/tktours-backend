# Contexto de negocio y resumen de reunión con LUZ

Este archivo existe para que cualquier asistente de IA o persona técnica pueda entender rápido de qué va el proyecto, qué se habló con Luz y qué decisiones de producto ya quedaron bastante claras.

## Proyecto

`tktours-concierge-backend-v2` es el backend v2 del concierge/assistant de TKTours para atender, calificar y orientar prospectos principalmente por WhatsApp.

El sistema no debe depender de respuestas improvisadas del modelo. La intención es que la IA use:

- catálogo estructurado de programas
- reglas de negocio por edad, fechas, tipo de programa y alojamiento
- recursos administrables por país/programa
- historial conversacional e inquiry persistido

## Objetivo de negocio

Ayudar a Luz y al equipo de TKTours a:

- recibir leads interesados en programas educativos
- hacer preguntas de calificación sin fricción
- identificar el tipo de programa correcto
- recomendar opciones válidas
- enviar links/recursos/cotizaciones correctas según país y tipo de programa
- evitar depender de PDFs fijos o información manual desactualizada

## Tipos de programa principales

### 1. Campamentos
- dirigidos a edades aproximadas de 7 a 18 años
- incluyen temporadas como verano, invierno y easter
- las fechas de inicio dependen de la temporada
- algunas opciones arrancan dentro de ventanas específicas y no todo el año

### 2. Cursos de idiomas
- disponibles desde aproximadamente los 15 años
- sin límite de edad superior claro
- pueden arrancar todo el año
- muchas escuelas manejan inicios frecuentes o semanales

### 3. Programas escolares
- semestre escolar
- año escolar
- mini stay grupal
- fechas de inicio más estables, pero materiales/promociones pueden cambiar con frecuencia

## Reglas de negocio que ya deben asumirse

- La IA no debe inventar programas, folletos, reglas, fechas ni precios.
- La IA debe apoyarse en catálogo y resources del sistema.
- La calificación del lead debe considerar como mínimo:
  - edad del estudiante
  - país de interés
  - tipo de programa
  - alojamiento deseado
  - fechas o mes/año preferidos
  - ciudad de residencia cuando aplique
  - duración/semanas cuando aplique
- Para menores de 13 años hay restricciones importantes en alojamiento tipo host family.
- Los campamentos y cursos de idiomas no comparten exactamente las mismas reglas de edad, temporada ni alojamiento.
- El sistema no debe trabarse si el usuario no responde todo; debe seguir siendo útil y mandar información base cuando falten datos.

## Decisión operativa importante

Luz va a subir y mantener enlaces directos de cotizaciones y materiales, y el sistema debe permitir administrarlos de forma sencilla.

Eso implica que el backend debe soportar bien:

- resources por país
- resources por tipo de programa/familia
- versionado
- activación/desactivación
- links externos
- materiales informativos sin precio
- cotizaciones mensuales actualizables

## Reunión con LUZ — resumen ejecutivo

La reunión se centró en cómo convertir el proceso manual de cotización en un sistema donde la IA pueda clasificar al estudiante y mandar la información correcta.

### Lo que Luz explicó

- Ya existía un ejemplo previo de formulario de solicitud.
- Ese formulario debía considerar información como:
  - edad del participante
  - ciudad de residencia
  - fechas preferidas
  - tipo de curso/programa
  - preferencias de alojamiento
- Los campamentos aplican a menores y adolescentes, mientras que los cursos de idiomas tienen reglas distintas por edad.
- Las fechas de inicio cambian según temporada.
- Los programas y promociones pueden cambiar con frecuencia, por lo que no conviene depender de material estático que se sube una sola vez al año.
- Los precios no viven fijos en una página pública porque cambian.
- Las escuelas ya no siempre envían folletos/manuales como antes, por lo que conviene una presentación informativa más ligera para cursos de idiomas.

### Lo que se acordó construir

- Un sistema donde Luz pueda subir fácilmente links de cotizaciones mensuales.
- Esos links deben categorizarse por país y por tipo de programa.
- La IA debe usar la información del estudiante para decidir qué cotización o recurso corresponde.
- Luz compartirá manuales, programas y materiales desde un drive para integrarlos en el sistema.
- Tuberia debe descargar e integrar esos materiales para que la IA tenga acceso a información vigente.
- Debe existir una versión de prueba para validación con Luz.

## Países mencionados como foco inicial

- Canadá
- Estados Unidos
- Inglaterra
- Italia
- Francia
- Irlanda

## Resumen estructurado de la reunión

### Formulario / calificación
Se habló de construir o adaptar el formulario de solicitud para capturar datos suficientes para recomendar programa y cotización. La idea base fue usar un ejemplo previo enviado por Luz y convertirlo en estructura de sistema.

Campos importantes:

- edad
- ciudad de residencia
- fechas preferidas
- tipo de curso o programa
- alojamiento
- país de destino
- semanas o duración cuando aplique

### Programas por edad
Luz explicó diferencias importantes:

- campamentos: típicamente de 7 a 18 años
- cursos de idiomas: desde 15 años
- residencia universitaria: disponible desde edades bajas en ciertos programas
- host family: no siempre disponible para menores pequeños

### Fechas / temporadas
- campamentos de verano: aproximadamente finales de junio a mediados de agosto
- campamentos de invierno: aproximadamente diciembre a finales de enero
- algunos programas arrancan en ventanas claras por temporada
- cursos de idiomas pueden tener inicios frecuentes o semanales durante el año
- programas escolares tienen fechas más estables, aunque promociones/materiales cambian más seguido

### Materiales y recursos
Luz planteó que:

- ya no conviene depender solo de folletos/manuales tradicionales
- hace falta una presentación informativa de cursos de idiomas sin precios
- las cotizaciones mensuales sí deben actualizarse periódicamente
- el sistema debe aceptar links directos y mantenerlos organizados

### Experiencia del usuario final
El asistente debe:

- preguntar lo necesario sin bloquear la conversación
- si faltan datos, seguir aportando algo útil
- siempre poder mandar información básica
- evitar quedarse detenido esperando una respuesta perfecta

## Siguientes pasos acordados

### Tuberia
- Modificar el sistema para que la IA categorice y envíe links de cotizaciones según edad, país, tipo de curso, alojamiento y otros datos del estudiante.
- Diseñar el sistema para que Luz suba fácilmente los links de cotizaciones mensuales por país y tipo de programa.
- Descargar los archivos del drive compartido por Luz e integrarlos al sistema.
- Asegurarse de que la IA pueda acceder y procesar información actualizada.
- Evitar que el flujo se trabe si el usuario no responde todo.
- Presentar una versión de prueba a Luz antes del viernes.

### Luz
- Generar y enviar cotizaciones base de 4 semanas para países clave al inicio de cada mes.
- Compartir el drive con manuales y programas.
- Preparar una presentación informativa de cursos de idiomas sin precios.
- Probar el sistema y dar feedback.
- Subir links de cotizaciones cuando el sistema esté listo.

## Traducción de esta reunión a requisitos del backend

### Requisito 1: catálogo estructurado
El backend debe tener programas con:

- país
- familia/tipo
- rango de edad
- reglas de alojamiento
- ventanas de inicio
- duración aplicable

### Requisito 2: resources administrables
El backend debe permitir:

- subir links externos
- subir archivos
- versionar materiales
- activar/desactivar recursos
- filtrar por país, familia y programa
- distinguir entre material informativo y cotización

### Requisito 3: inquiry persistido
Cada lead debe guardar, conforme se descubra:

- edad
- país de interés
- familia o tipo de programa
- programa específico si ya se conoce
- ciudad de residencia
- mes/año preferidos
- alojamiento
- semanas
- notas de calificación

### Requisito 4: orquestación de IA
La IA debe:

- leer el contexto de conversación
- detectar faltantes
- actualizar el inquiry
- consultar programas válidos
- recomendar sin inventar
- decidir cuándo enviar recursos

### Requisito 5: tolerancia a información incompleta
La IA no debe romper el flujo si faltan respuestas. Debe poder:

- pedir un siguiente dato clave
- dar información general mientras tanto
- continuar en otra etapa después

## Alcance actual esperado del proyecto

Este backend no es solo un CRUD. Debe convertirse en la base operativa del concierge de TKTours para:

- intake de leads
- calificación
- recomendación
- envío de recursos
- trazabilidad de conversaciones
- futura integración con pricing/cotizaciones más avanzadas

## Pendientes funcionales implícitos que esta reunión deja claros

- Mejorar soporte multi-país más allá de Canadá.
- Cargar cotizaciones mensuales por país.
- Integrar materiales de drive compartido.
- Tener recursos informativos para language courses sin precio.
- Afinar reglas de edad/alojamiento por programa.
- Eventualmente resolver mejor pricing dinámico, ya que los precios cambian con frecuencia.

## Nota para futuros asistentes de IA

Si retomas este proyecto, asume esto como verdad operativa:

1. El proyecto gira alrededor de TKTours/LUZ y un concierge para programas educativos.
2. La IA no debe inventar datos de programas o cotizaciones.
3. Los resources y links actualizados por Luz son parte central del sistema.
4. El flujo debe seguir funcionando aunque falten respuestas del lead.
5. El objetivo no es solo contestar bonito; es calificar, recomendar y mandar recursos correctos.
