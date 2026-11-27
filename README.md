# Fighting Overlay OBS — v0.3

Overlay local para OBS con marcador W/L, win rate, racha, mains por juego y una primera detección experimental de personajes de 2XKO a partir del HUD.

## Requisitos

- Windows 10/11 (también puede ejecutarse en macOS/Linux con Node.js).
- Node.js 18 o superior.
- OBS Studio.
- Chrome o Edge actualizado para la detección por captura de pantalla.
- Conexión a internet la primera vez que se inicia el OCR (descarga Tesseract.js y el modelo de inglés desde CDN).

## Iniciar el proyecto

1. Descomprime `fighting-overlay-obs-v0.3.zip` en una carpeta nueva.
2. Si ya usabas v0.1 y quieres conservar tus estadísticas, copia el archivo `data.json` de la carpeta anterior a esta carpeta nueva. La versión 0.2 lo migra al abrir el servidor.
3. Abre la carpeta `fighting-overlay-obs`.
4. Haz doble clic en `start.bat` o ejecuta `npm start` desde esa carpeta.
5. Mantén abierta la ventana de terminal.
6. Abre `http://127.0.0.1:3000/dashboard` en Chrome o Edge.

No necesita `npm install`: el servidor usa módulos nativos de Node.js. La librería OCR se carga en el navegador desde jsDelivr.

## Añadirlo a OBS

1. En OBS, en tu escena, pulsa **+ → Fuente de navegador**.
2. Nombre sugerido: `Fighting Overlay`.
3. URL: `http://127.0.0.1:3000/overlay`.
4. Ancho: `1920`; alto: `1080`.
5. Activa el fondo transparente si OBS muestra esa opción. La página fuerza transparencia también en el elemento raíz HTML y en el body; el fondo oscuro se reserva exclusivamente para el panel de control. Si OBS conserva una vista anterior, pulsa **Actualizar caché de la página actual** en las propiedades de la fuente de navegador o elimina y vuelve a crear la fuente.
6. Mueve la fuente por encima del juego y ajusta posición/tamaño desde el panel web.

El diseño inicial usa la esquina superior derecha, por debajo de la barra de marcador de tu escena de referencia.

## Detección de personajes de 2XKO

1. Abre el panel en Chrome o Edge.
2. Guarda `2XKO` como juego activo.
3. En **Detectar personajes**, selecciona el lado en el que aparece tu jugador: izquierda o derecha.
4. Pulsa **Iniciar detección**.
5. En el selector de Chrome/Edge, comparte la ventana de 2XKO (no la ventana del panel).
6. Mantén visible la ventana compartida. El recorte del HUD aparece debajo del estado para que puedas comprobar si está tomando la zona correcta.
7. Cuando el mismo equipo se reconozca en dos lecturas consecutivas, los nombres se guardan y aparecen en la fila **EN PARTIDA** de la overlay.
8. Pulsa **Usar personajes detectados como mis mains** para copiarlos al perfil guardado.

El detector busca los nombres del roster jugable de 2XKO (incluyendo Sett y Samira). Es experimental: cambios de resolución, escalado, idioma, HUD o elementos que tapen las etiquetas pueden afectar al OCR. Si falla, prueba el otro lado o usa la edición manual de tus mains.

### Privacidad de la captura

La captura se procesa en el navegador del propio equipo mediante Tesseract.js. No se graba, no se guarda en disco y los fotogramas no se envían al servidor local del overlay; únicamente se envían los nombres detectados para actualizar el marcador. La librería y el modelo OCR sí se descargan desde CDN durante la primera carga.

## Retratos y selección visual de mains (v0.3)

- La selección de mains ahora incluye una galería con los retratos PNG de `Lycan-ve/Hot-Coffee-Frontend/public/fighters`.
- Los retratos aparecen junto al nombre tanto en el panel y su vista previa como en la Browser Source de OBS.
- La selección admite hasta tres mains y sincroniza el campo de texto, para que también puedas escribir los nombres manualmente.
- Los PNG se cargan desde `raw.githubusercontent.com` usando las imágenes públicas de tu repositorio. Se necesita conexión a internet para que aparezcan; si alguna imagen no carga, el nombre sigue visible.

## Qué incluye v0.3

- Perfiles independientes para 2XKO, Mortal Kombat 1 y Guilty Gear Strive.
- Marcador W/L, win rate y racha por juego.
- Hasta tres mains editables por perfil.
- Botones manuales para victoria y derrota.
- Posición, tamaño y opacidad configurables.
- Vista previa con la captura de OBS proporcionada como fondo de referencia (no se muestra en la Browser Source del overlay).
- Detección OCR experimental de campeones de 2XKO a partir de la captura de la ventana compartida.
- Persistencia local en `data.json`.

## Limitación conocida

La detección automática de resultados de victoria/derrota todavía no está implementada. Los resultados W/L se registran con los botones del panel. La detección de personajes funciona solo con 2XKO en esta versión; Mortal Kombat 1 y Guilty Gear Strive mantienen selección manual.

## Roster de 2XKO

La lista se basa en la [galería oficial de campeones](https://2xko.riotgames.com/en-us/champions/) y en las [notas oficiales del parche 1.3.3 del 27 de octubre de 2026](https://2xko.riotgames.com/en-us/news/game-updates/2xko-patch-notes-133-october-27-2026/), que añadieron Sett y Samira.


## Control desde el teléfono

1. Conecta el PC y el teléfono a la misma red Wi‑Fi.
2. Ejecuta `start.bat` en el PC.
3. En el dashboard del PC (`http://127.0.0.1:3000/dashboard`) encontrarás la dirección local y el código de conexión de seis dígitos.
4. Abre esa dirección en el navegador del teléfono, introduce el código y pulsa Conectar.
5. Usa VICTORIA o DERROTA; el marcador de OBS se actualiza en tiempo real.

El servidor escucha en la red local para permitir el acceso móvil. El código cambia cada vez que reinicias el servidor. No compartas la dirección ni el código fuera de tu red de confianza. Si Windows Firewall pregunta, permite el acceso en redes privadas.
