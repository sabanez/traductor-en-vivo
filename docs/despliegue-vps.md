# Despliegue en el VPS

Instalación de pruebas en un VPS propio (Ubuntu 26.04 LTS), publicada en **https://livetranslate.labolife.com**. Sustituye a Render, cuyo plan gratuito se duerme a los 15 minutos.

Este documento no contiene secretos. La clave de Soniox y la contraseña de acceso solo están en el servidor, en `/etc/traductor.env`.

## Qué hay y dónde

| Qué | Dónde | Notas |
|---|---|---|
| Código | `/opt/traductor/app` | Clon de este repositorio. Pertenece al usuario `traductor`. |
| Usuario de la app | `traductor` | Usuario de sistema, sin shell ni sudo. El usuario `ubuntu` no puede entrar en `/opt/traductor`, así que hay que usar `sudo -u traductor`. |
| Deploy key | `/opt/traductor/.ssh/id_ed25519` | Clave de solo lectura, dada de alta en GitHub > Settings > Deploy keys. Sirve para hacer `git pull`. |
| Secretos y configuración | `/etc/traductor.env` | `SONIOX_API_KEY`, `SONIOX_REGION`, `PORT=3001` y `ACCESS_PASSWORD`. Propietario `root:traductor`, permisos 640. |
| Servicio | `/etc/systemd/system/traductor.service` | Arranca con el sistema y se reinicia si cae. Ejecuta `tsx server/index.ts` con `NODE_ENV=production`. |
| Web compilada | `/opt/traductor/app/dist/public` | La genera `npm run build` y la sirve el propio servidor Node. |
| Proxy HTTPS | `/etc/caddy/Caddyfile` | Caddy obtiene y renueva solo el certificado de Let's Encrypt y reenvía a `127.0.0.1:3001`, WebSocket incluidos. |
| Script de actualización | `/usr/local/bin/traductor-actualizar` | Hace `git pull`, compila y reinicia (ver más abajo). |
| Node.js | Paquete `nodejs` 22 de NodeSource | Se actualiza con `apt`. |

Seguridad del sistema:

- Firewall `ufw`: solo están abiertos los puertos 22 (SSH), 80 y 443. El 3001 no es accesible desde fuera.
- `unattended-upgrades` instala solo las actualizaciones de seguridad.
- 2 GB de swap en `/swapfile`, para que el build no se quede sin memoria.

## Actualizar a la última versión de `main`

```bash
traductor-actualizar
```

Si falla el `git pull`, `npm ci` o el build, el script se detiene sin reiniciar y sigue funcionando la versión anterior.

**Reiniciar borra las salas**, porque se guardan en memoria. No actualices durante una presentación. Después de reiniciar, el ponente obtiene una sala nueva y hay que volver a compartir el enlace.

Contenido del script, por si hay que recrearlo:

```bash
#!/bin/bash
set -euo pipefail
sudo -u traductor bash -c 'cd /opt/traductor/app && git pull --ff-only && npm ci --include=dev && npm run build'
sudo systemctl restart traductor
sleep 3; systemctl is-active traductor && journalctl -u traductor -n 3 --no-pager
```

## Cambiar la configuración o los secretos

```bash
sudo nano /etc/traductor.env
sudo systemctl restart traductor
```

Para comprobar que cada variable tiene valor sin mostrarlo:

```bash
sudo awk -F= 'NF{print $1": "($2==""?"VACÍA":"ok")}' /etc/traductor.env
```

Cuando Soniox apruebe la región de la UE, cambia `SONIOX_REGION=global` por `SONIOX_REGION=eu`.

## Diagnóstico

```bash
systemctl status traductor --no-pager           # ¿está en marcha?
sudo journalctl -u traductor -n 50 --no-pager   # logs de la app
sudo journalctl -u traductor -f                 # logs en directo
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/   # 401 = funciona (pide contraseña)
curl -s https://livetranslate.labolife.com/healthz                # de punta a punta, a través de Caddy

systemctl status caddy --no-pager
sudo journalctl -u caddy -n 50 --no-pager       # errores de certificado o de proxy
sudo caddy validate --config /etc/caddy/Caddyfile
```

Problemas habituales:

- **`status=203/EXEC` en el servicio**: falta `node_modules`. Ejecuta `traductor-actualizar` o haz `npm ci` como usuario `traductor`.
- **Error de certificado en Caddy**: comprueba que los registros A y AAAA de `livetranslate.labolife.com` apuntan a este VPS (`getent ahosts livetranslate.labolife.com`) y que los puertos 80 y 443 están abiertos tanto en `ufw` como en el firewall de red del panel del proveedor.
- **El micrófono no funciona**: el navegador solo lo permite con HTTPS. Entra siempre por `https://livetranslate.labolife.com`, nunca por la IP.

## Archivos de configuración

`/etc/systemd/system/traductor.service`:

```ini
[Unit]
Description=Traductor en vivo
After=network-online.target
Wants=network-online.target

[Service]
User=traductor
Group=traductor
WorkingDirectory=/opt/traductor/app
EnvironmentFile=/etc/traductor.env
Environment=NODE_ENV=production
ExecStart=/opt/traductor/app/node_modules/.bin/tsx server/index.ts
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

`/etc/caddy/Caddyfile`:

```
livetranslate.labolife.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3001
}
```

## Pendientes

- **SSH con contraseña.** Todavía se entra con contraseña y `authorized_keys` está vacío. Antes de usarlo en una presentación real, hay que pasar a claves SSH y desactivar la contraseña con `PasswordAuthentication no`. Mientras tanto, conviene instalar `fail2ban`.
- **Región UE de Soniox.** Ahora se usa `global` (EE. UU.). Hay que pedir la región UE en la consola de Soniox antes de usarlo de verdad.
- **Render.** Sigue activo como respaldo y se despliega con cada cambio en `main`. La propuesta es mantenerlo unas dos semanas y después borrar el servicio y su clave de Soniox.
- **Copias de seguridad.** No hacen falta para los datos, porque no hay base de datos. Lo único que no está en el repositorio es `/etc/traductor.env` y los archivos de este documento.
