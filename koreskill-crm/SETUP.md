# KoreSkill CRM — Guía de Setup

## 1. Google Service Account (credenciales)

### Crear el service account:
1. Ir a https://console.cloud.google.com
2. Crear un proyecto nuevo (o usar uno existente)
3. Activar la API: **Google Sheets API**
4. Ir a **Credenciales → Crear credencial → Cuenta de servicio**
5. Dale un nombre (ej: "koreskill-crm") y creá
6. En la cuenta creada, ir a **Claves → Agregar clave → JSON**
7. Descargá el JSON y guardalo como `credentials.json` en la carpeta del proyecto

### Dar acceso al Google Sheet:
1. Abrí el JSON descargado y copiá el campo `"client_email"` (algo como `xxx@xxx.iam.gserviceaccount.com`)
2. Abrí tu Google Sheet
3. Botón **Compartir** → pegá ese email → dale permiso de **Editor**

---

## 2. Agregar las columnas al Google Sheet

En tu sheet, agregá estas columnas al final (columna M, N, O):
- **M**: `etapa` (dejar vacío = Sin Contactar automático)
- **N**: `notas`
- **O**: `ultimo_contacto`

---

## 3. Deploy en VPS

```bash
# Clonar / copiar el proyecto al VPS
cd /var/www/koreskill-crm

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
nano .env  # completar SPREADSHEET_ID, SHEET_NAME, PORT

# Copiar credentials.json al directorio
# (subir por SCP o pegar el contenido)

# Arrancar
npm start

# Con PM2 (recomendado para producción):
npm install -g pm2
pm2 start server.js --name koreskill-crm
pm2 save
pm2 startup
```

### Con nginx (reverse proxy):
```nginx
server {
    listen 80;
    server_name crm.tudominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 4. Variables de mensaje disponibles

En la sección **Mensajes** del CRM podés usar estas variables:
- `{{nombre}}` → Nombre del negocio
- `{{rubro}}` → Categoría del negocio
- `{{ciudad}}` → Ciudad
- `{{web}}` → Sitio web

---

## Etapas del pipeline

| Etapa | Descripción |
|-------|-------------|
| 📋 Sin Contactar | Aún no se envió ningún mensaje |
| 📤 Enviado | Primer mensaje enviado (se setea automáticamente al hacer clic en WA) |
| 💬 Respondió | El prospecto respondió |
| 🤝 Interesado | Mostró interés real |
| ✅ Cerrado | Cliente cerrado |
| ❌ No Interesado | No le interesa |
