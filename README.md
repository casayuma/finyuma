# Bitácora de Turnos — HTML en GitHub + Firestore

La misma arquitectura de siempre: los archivos HTML viven en este repo de
GitHub, y los datos (horarios, PINes, historial de semanas, ocupación) se
guardan en **Firestore** — con actualización en tiempo real (`onSnapshot`),
igual que antes. `git push` publica solo, sin pasos manuales.

**Reemplaza a `casayuma-bitacora-appsscript` y a
`casayuma-bitacora-cloudflare`** — usa solo esta versión.

## Dónde vive esto en tu repo real (`casayuma/finyuma`)

Este proyecto **no es un repo nuevo** — es lo que ya subiste como
`dashboard.html` dentro de `finyuma`, junto a `pagos.html`,
`requisiciones.html` y `auditoria.html`. GitHub Pages ya publica ese repo
solo en cada push, así que **no toques `firebase.json` ni la parte de
"hosting"** de este README — eso queda reemplazado por GitHub Pages, que ya
tienes andando. Lo único que sigue haciendo falta de aquí es la parte de
**Firestore + Cloud Functions** (pasos 1 a 7 más abajo), que es un proyecto
de Google Cloud aparte y no tiene nada que ver con GitHub Pages.

Tu `index.html` actual (el portal "¿A dónde vamos?") es un archivo
totalmente aparte — tiene su propio login con PIN contra otro backend
(`CONFIG.WEBAPP_URL`, un Apps Script distinto) y una tarjeta **"Horarios
Universal"**. **No lo toques.** Solo hay que corregir el link de esa
tarjeta: hoy apunta al Apps Script viejo (el que fallaba al entrar desde
otros celulares):

```js
{id:'horarios', ..., href:'https://script.google.com/macros/s/AKfycbxDa9t3s3EtCfg4hdhEWAz7r3PbCQcMznQBlP6wD_EkVz4zrN_-utGZQb77YIX2Ye_j/exec', ...}
```

Cámbialo por:

```js
{id:'horarios', ..., href:'dashboard.html', ...}
```

(Puedes usar la ruta relativa `dashboard.html` porque los dos archivos están
en el mismo repo/carpeta — así también funciona igual de bien si en algún
momento cambias de dominio.) Ese es el único cambio pendiente en
`index.html`.

## Cómo está armado

- **`index.html`** — el cliente. Lee `departamentos`, `horarios` y
  `ocupación` directo de Firestore en tiempo real. Visualmente idéntico a
  siempre.
- **`functions/`** — tres Cloud Functions pequeñas que sí necesitan pasar
  por un servidor: `loginStart`/`loginSubmit` (el PIN nunca sale de aquí) y
  `saveSchedule` (siempre vuelve a comprobar que quien guarda de verdad
  tiene permiso sobre ese departamento). Además, `syncNomina` y
  `syncOcupacion`, programadas, igual que los triggers de antes.
- **`firestore.rules`** — cualquiera puede LEER departamentos/horarios/
  ocupación (como en la vista pública "Todos"); NADIE puede escribir
  directo — todo escrito pasa por las Cloud Functions de arriba. Los PINes
  (colección `users`) no son ni siquiera legibles desde el navegador.
- **`.github/workflows/deploy.yml`** — en cada `git push` a `main`, publica
  solo: el sitio, las funciones, y las reglas. No hace falta correr nada
  en tu computadora para el día a día.

## Puesta en marcha (una sola vez)

### 1. Crea el proyecto de Firebase

En [console.firebase.google.com](https://console.firebase.google.com) →
**Crear proyecto**. Puedes usar tu cuenta de casayuma.com sin problema —
esto es un producto distinto a Apps Script y no tiene la misma
restricción de "compartir fuera de la organización" que te bloqueaba
antes.

### 2. Activa Firestore

**Compilación → Firestore Database → Crear base de datos** → modo
**producción** → elige una región (`us-central` o la más cercana a México
que te ofrezca).

### 3. Activa el plan Blaze

**⚙️ Configuración del proyecto → Uso y facturación → Modificar plan →
Blaze**. Es agregar una tarjeta — a este volumen de uso (un hotel, un
puñado de líderes editando horarios) el cobro esperado es $0/mes; Blaze
solo habilita que el proyecto pueda usar Cloud Functions.

### 4. Registra la app web y pega su configuración

**⚙️ Configuración del proyecto → tus apps → ícono `</>`  (Web)** → dale
un nombre → **Registrar app**. Te va a mostrar un bloque `firebaseConfig`.

Copia esos valores a `index.html`, al inicio del `<script type="module">`
(busca `firebaseConfig`) — reemplaza los `"PEGA-AQUI..."`. Esta
configuración es pública a propósito (así funciona cualquier app de
Firebase) — la protección real está en las reglas de Firestore y en las
Cloud Functions, no en ocultar esto.

### 5. Crea la cuenta de servicio para que GitHub pueda publicar

**⚙️ Configuración del proyecto → Cuentas de servicio → Generar nueva
clave privada** — descarga el archivo `.json`. Para simplificar, dale a
esa cuenta de servicio el rol **Editor** desde **IAM y administración →
IAM** (más simple que armar la lista exacta de permisos que pide un
despliegue de Cloud Functions de 2.ª generación — Cloud Functions, Cloud
Build, Artifact Registry, Secret Manager, Cloud Scheduler, Eventarc).

### 6. Configura los secretos en GitHub

En tu repo: **Settings → Secrets and variables → Actions → New repository
secret** — agrega:

| Secreto | Valor |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | el contenido completo del `.json` del paso 5 |
| `FIREBASE_PROJECT_ID` | el ID de tu proyecto (Configuración del proyecto → ID del proyecto) |
| `CLOUDBEDS_TOKEN` | tu API key de Cloudbeds |
| `CLOUDBEDS_PROPERTY_ID` | `317385` |
| `TOTAL_ROOMS` | *(opcional — 25 por default)* |
| `NOMINA_CSV_URL` | ver el paso 7 |

### 7. Conecta tu hoja de nómina real

La app necesita leer "Contrataciones - Organigrama" para saber quién
trabaja en cada departamento:

1. Abre esa hoja desde tu cuenta de casayuma.com.
2. **Archivo → Compartir → Publicar en la Web**.
3. Elige la pestaña correcta, formato **Valores separados por comas
   (.csv)**, y dale **Publicar**.
4. Copia el link y guárdalo como el secreto `NOMINA_CSV_URL` (paso 6).

**Si ese link también sale bloqueado** por la política de tu
organización: exporta esa pestaña como `.csv` a mano y súbela a este repo
en `data/nomina.csv`; usa como `NOMINA_CSV_URL` su link "raw" de GitHub
(`https://raw.githubusercontent.com/tu-usuario/tu-repo/main/data/nomina.csv`).
El código funciona igual, solo cambia de dónde lee el CSV — aunque con
esta opción el personal ya no se actualiza solo, hay que volver a subir
el archivo cada vez que cambie la nómina.

Si dejas `NOMINA_CSV_URL` vacío, la app arranca con una copia de respaldo
del personal (la que ya tenías capturada) hasta que la configures.

### 8. Publica

```bash
git push origin main
```

Eso dispara `.github/workflows/deploy.yml`, que publica las **funciones y
las reglas de Firestore** (el sitio ya lo publica GitHub Pages solo, aparte
de este flujo). Puedes ver el progreso en la pestaña **Actions** de tu repo
en GitHub. Cuando termine (2-4 minutos la primera vez), tu Bitácora ya
lee/escribe contra Firestore real, viva en:

```
https://casayuma.github.io/finyuma/dashboard.html
```

Ese es el link que hoy abre la tarjeta "Horarios Universal" del portal
(una vez que corrijas su `href`, ver arriba) — abre en cualquier celular,
sin pedir cuenta de Google ni inicio de sesión de ningún tipo.

### 9. Primera sincronización de nómina

`syncNomina` corre sola una vez al día. Para que el personal real aparezca
desde el primer momento (en vez de esperar hasta 24h), dispárala a mano
una sola vez: en
[console.cloud.google.com/cloudscheduler](https://console.cloud.google.com/cloudscheduler)
(mismo proyecto), busca el job de `syncNomina` → **⋮ → Forzar ejecución**.

## De aquí en adelante

Edita lo que sea (código, `functions/lib/departments.js` para cambiar
quién es líder, lo que sea), `git push`, y en unos minutos ya está en
línea — sin tocar nada a mano en ningún lado.

## Qué cambia respecto a las versiones anteriores

- **Tiempo real de verdad, otra vez.** `onSnapshot` — como siempre lo
  tuvieron. Nada de refrescar cada 20 segundos: un cambio se ve al
  instante en cualquier pestaña abierta.
- **Ningún Google Workspace de por medio.** Firebase/Firestore es un
  producto distinto a Apps Script, sin la restricción de "compartir fuera
  de la organización" que bloqueaba el acceso desde otros celulares.
- **La sesión se recuerda entre visitas** (antes se perdía al cerrar el
  navegador) — cada líder no tiene que volver a escribir su PIN cada vez
  que abre la página desde su celular.
- **Seguridad igual de estricta que antes.** El PIN nunca sale del
  servidor (colección `users` ilegible desde el navegador), y
  `saveSchedule` siempre vuelve a comprobar permisos del lado del
  servidor — nunca confía en lo que diga el cliente.
- **Los datos empiezan vacíos otra vez.** Firestore es un almacenamiento
  distinto a los anteriores. Si quieres que te ayude a migrar el
  historial que ya tengas capturado antes de apagar la versión vieja,
  dímelo.

## Notas honestas

- **Blaze es obligatorio** para usar Cloud Functions, aunque a este
  volumen el cobro esperado sea $0/mes — es una tarjeta de por medio, no
  necesariamente un gasto.
- El rol **Editor** en la cuenta de servicio es más amplio de lo
  estrictamente necesario, pero mucho más simple de configurar bien que
  la lista exacta de roles que pide un despliegue de Cloud Functions de
  2.ª generación. Si prefieres algo más ajustado, dímelo y armamos la
  lista exacta.
- Cada `git push` vuelve a guardar el secreto `CLOUDBEDS_TOKEN` en Secret
  Manager (aunque no haya cambiado) — no hace daño, solo acumula
  versiones con el tiempo.
- Los triggers programados (`syncNomina`, `syncOcupacion`) tampoco son
  perfectamente puntuales — pueden atrasarse uno o dos minutos, no es un
  bug de este proyecto.
