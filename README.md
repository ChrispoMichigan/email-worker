# email-worker

API HTTP para envío de emails masivos y programados. Usa BullMQ + Redis como cola de trabajos y BillionMail (o cualquier SMTP) para el envío real.

## Stack

- **Express** — servidor HTTP
- **BullMQ + Redis** — cola de jobs (envío async, reintentos, delayed jobs)
- **Nodemailer** — envío SMTP
- **Handlebars** — plantillas HTML
- **html-to-text** — generación automática de texto plano
- **ioredis** — tracking de estado de emails

## Requisitos

- Node.js >= 18
- pnpm
- Redis corriendo localmente o en red

## Instalación y uso

```bash
pnpm install
cp .env.example .env   # llenar con credenciales reales
pnpm dev               # desarrollo con hot-reload
pnpm start             # producción
```

---

## Variables de entorno

| Variable | Descripción | Requerida | Ejemplo |
|---|---|---|---|
| `SMTP_HOST` | Host del servidor SMTP | Sí | `mail.tudominio.com` |
| `SMTP_PORT` | Puerto SMTP | Sí | `587` |
| `SMTP_SECURE` | TLS en el puerto (true para 465) | No | `false` |
| `SMTP_USER` | Usuario SMTP | Sí | `noreply@tudominio.com` |
| `SMTP_PASS` | Contraseña SMTP | Sí | `tu_password` |
| `SMTP_FROM` | Dirección remitente | Sí | `noreply@tudominio.com` |
| `REDIS_HOST` | Host de Redis | No | `127.0.0.1` |
| `REDIS_PORT` | Puerto de Redis | No | `6379` |
| `WORKER_CONCURRENCY` | Emails en paralelo por worker | No | `5` |
| `UNSUBSCRIBE_BASE_URL` | URL base para links de baja (se añade `?email=...`) | No | `https://tudominio.com/administracion` |
| `PORT` | Puerto del servidor HTTP | No | `3000` |

---

## Endpoints

### `POST /send` — Enviar un email

Encola un email para un destinatario. Responde inmediatamente con el ID del job.

**Body:**

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `to` | string | Sí | Dirección de destino |
| `subject` | string | Sí | Asunto del email |
| `html` | string | Sí* | HTML del email |
| `template` | string | Sí* | Nombre de plantilla en `templates/` (sin `.html`) |
| `variables` | object | No | Variables para la plantilla Handlebars |
| `scheduledAt` | string (ISO 8601) | No | Fecha/hora de envío programado |

*Se requiere `html` o `template`, no ambos.

**Respuesta:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "scheduledAt": null
}
```

**Ejemplo — envío inmediato con HTML inline:**
```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "usuario@ejemplo.com",
    "subject": "Bienvenido",
    "html": "<h1>Hola!</h1><p>Gracias por registrarte.</p>"
  }'
```

**Ejemplo — envío programado:**
```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "usuario@ejemplo.com",
    "subject": "Recordatorio",
    "html": "<p>Este es tu recordatorio.</p>",
    "scheduledAt": "2026-06-20T15:00:00Z"
  }'
```

**Ejemplo — usando plantilla en disco:**
```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "usuario@ejemplo.com",
    "subject": "Bienvenido",
    "template": "bienvenida",
    "variables": { "nombre": "Juan", "empresa": "Acme" }
  }'
```

---

### `POST /send/bulk` — Envío masivo

Encola emails para múltiples destinatarios en una sola llamada. Cada destinatario es un job independiente con seguimiento propio.

**Body:**

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `recipients` | array | Sí | Lista de destinatarios |
| `recipients[].to` | string | Sí | Email del destinatario |
| `recipients[].variables` | object | No | Variables individuales para la plantilla |
| `subject` | string | Sí | Asunto del email |
| `html` | string | Sí* | HTML del email (igual para todos) |
| `template` | string | Sí* | Nombre de plantilla en `templates/` |
| `scheduledAt` | string (ISO 8601) | No | Fecha/hora de envío (aplica a todos) |

**Respuesta:**
```json
{
  "batchId": "a3f2c1b0-...",
  "queued": 3,
  "status": "queued",
  "scheduledAt": null,
  "jobIds": [
    "550e8400-...",
    "6ba7b810-...",
    "6ba7b811-..."
  ]
}
```

**Ejemplo — campaña masiva inmediata:**
```bash
curl -X POST http://localhost:3000/send/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Campaña Junio 2026",
    "html": "<h1>Oferta especial!</h1>",
    "recipients": [
      { "to": "ana@ejemplo.com" },
      { "to": "bob@ejemplo.com" },
      { "to": "carlos@ejemplo.com" }
    ]
  }'
```

**Ejemplo — campaña programada con plantilla y variables individuales:**
```bash
curl -X POST http://localhost:3000/send/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Tu resumen mensual",
    "template": "resumen",
    "scheduledAt": "2026-07-01T09:00:00Z",
    "recipients": [
      { "to": "ana@ejemplo.com", "variables": { "nombre": "Ana", "total": 42 } },
      { "to": "bob@ejemplo.com", "variables": { "nombre": "Bob", "total": 17 } }
    ]
  }'
```

---

### `GET /jobs/:jobId` — Estado de un email

Devuelve el estado y metadatos de un email específico.

**Parámetros de ruta:**

| Parámetro | Descripción |
|---|---|
| `jobId` | ID devuelto por `/send` o en `jobIds` de `/send/bulk` |

**Respuesta:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "job_id": "1",
  "batch_id": "",
  "to_email": "usuario@ejemplo.com",
  "subject": "Campaña Junio",
  "template": "[inline]",
  "status": "sent",
  "scheduled_at": "",
  "error": "",
  "created_at": "2026-06-13T10:00:00.000Z",
  "updated_at": "2026-06-13T10:00:05.123Z"
}
```

**Valores de `status`:**

| Status | Significado |
|---|---|
| `queued` | En cola, pendiente de procesar |
| `scheduled` | Programado, esperando su hora de envío |
| `processing` | El worker lo está procesando ahora |
| `sent` | Enviado exitosamente |
| `failed` | Falló tras 3 intentos |

---

### `GET /jobs` — Listar emails

Lista emails con filtros opcionales y paginación.

**Query params:**

| Parámetro | Tipo | Descripción |
|---|---|---|
| `status` | string | Filtrar por estado: `queued`, `scheduled`, `processing`, `sent`, `failed` |
| `batchId` | string | Filtrar por ID de lote (devuelto por `/send/bulk`) |
| `to` | string | Filtrar por dirección (búsqueda parcial) |
| `limit` | number | Máximo de resultados (default: 50) |
| `offset` | number | Saltar N resultados para paginación (default: 0) |

**Respuesta:**
```json
{
  "rows": [ /* array de emails */ ],
  "total": 150
}
```

**Ejemplos:**
```bash
# Ver emails fallidos
GET /jobs?status=failed

# Ver todos los emails de un lote
GET /jobs?batchId=a3f2c1b0-...

# Ver emails programados pendientes
GET /jobs?status=scheduled

# Buscar por destinatario con paginación
GET /jobs?to=@ejemplo.com&limit=20&offset=40
```

---

## Emails programados

Envía `scheduledAt` con una fecha ISO 8601 en el futuro. Los jobs programados se almacenan en Redis y **sobreviven reinicios del servidor** — si el servidor se cae y vuelve a levantar antes de la hora programada, el email se envía igualmente cuando llega el momento.

```json
"scheduledAt": "2026-12-25T08:00:00Z"   // UTC
"scheduledAt": "2026-12-25T08:00:00-06:00"  // con timezone
```

- Si `scheduledAt` está en el pasado → **error 400**
- Si `scheduledAt` no se envía → **envío inmediato**
- El status inicial es `"scheduled"` en vez de `"queued"`
- Para cancelar un email programado, no hay endpoint de cancelación (pendiente de implementar)

---

## Plantillas

Las plantillas se guardan en `templates/*.html`. Usan sintaxis **Handlebars** para variables dinámicas.

```html
<!-- templates/bienvenida.html -->
<h1>Hola, {{nombre}}!</h1>
<p>Bienvenido a {{empresa}}.</p>
{{#if cta_url}}
<a href="{{cta_url}}">{{cta_texto}}</a>
{{/if}}
```

Para usarla:
```json
{
  "template": "bienvenida",
  "variables": { "nombre": "Juan", "empresa": "Acme", "cta_url": "https://..." }
}
```

Las plantillas se cachean en memoria al primer uso.

---

## Comportamiento automático en todos los emails

- **Texto plano** — se genera automáticamente a partir del HTML y se incluye como `text/plain` en el email (mejora deliverability y compatibilidad).
- **Header de baja** — si `UNSUBSCRIBE_BASE_URL` está configurada, se añade el header `List-Unsubscribe` y un footer con link de baja al HTML. Cumple con RFC 2369 y RFC 8058 (one-click unsubscribe).
- **Reintentos** — si el SMTP falla, se reintenta hasta 3 veces con backoff exponencial (5s, 25s, 125s).
