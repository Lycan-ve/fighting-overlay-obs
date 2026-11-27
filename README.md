# Fighting Overlay OBS — v0.5

Overlay local para OBS con marcador W/L, win rate, racha, detección automática de personajes de 2XKO, registro automático de victorias y derrotas, detección del equipo rival, historial de partidas, estadísticas por personaje y **un tema visual distinto para cada juego**.

## Temas por juego (v0.5)

La overlay cambia sola de diseño según el juego activo, también en la vista previa del panel:

*   **2XKO** — tema ámbar de la escena del canal: bordes dorados redondeados, acento verde azulado a oro, tipografía Barlow Condensed.
*   **Mortal Kombat 1** — sangre y oro: fondo granate oscuro, ángulos rectos, acento rojo a oro y tipografía épica Cinzel.
*   **Guilty Gear Strive** — neón: púrpura profundo, magenta y cian brillantes, barra lateral magenta, tipografía techno Chakra Petch con inclinaciones rápidas.

Los temas viven en `public/themes.css`; solo cambian colores, formas y tipografías, la información mostrada es la misma.

## Requisitos

*   Windows 10/11 (también puede ejecutarse en macOS/Linux con Node.js).
*   Node.js 18 o superior.
*   OBS Studio.
*   Chrome o Edge actualizado para la detección por captura de pantalla.
*   Conexión a internet la primera vez que se inicia el OCR (descarga Tesseract.js y el modelo de inglés desde CDN).

## Iniciar el proyecto

1.  Descarga o clona este repositorio en una carpeta.
2.  Si ya usabas v0.3 o v0.4, tu archivo `data.json` se conserva y se migra automáticamente.
3.  Abre la carpeta del proyecto.
4.  Haz doble clic en `start.bat` o ejecuta `npm start` desde esa carpeta.
5.  Mantén abierta la ventana de terminal.
6.  Abre `http://127.0.0.1:3000/dashboard` en Chrome o Edge.

No necesita `npm install`: el servidor usa módulos nativos de Node.js. La librería OCR se carga en el navegador desde jsDelivr.

## Añadirlo a OBS

1.  En OBS, en tu escena, pulsa **+ → Fuente de navegador**.
2.  Nombre sugerido: `Fighting Overlay`.
3.  URL: `http://127.0.0.1:3000/overlay`.
4.  Ancho: `1920`; alto: `1080`.
5.  Activa el fondo transparente si OBS muestra esa opción. Si OBS conserva una vista anterior, pulsa **Actualizar caché de la página actual** en las propiedades de la fuente de navegador o elimina y vuelve a crear la fuente.
6.  Mueve la fuente por encima del juego y ajusta posición/tamaño desde el panel web.

## Automatización (v0.4)

Con la detección activa, el panel alterna la lectura entre tres zonas de la captura: tu equipo, el equipo rival y la zona central de resultado.

### Registro automático de victorias y derrotas

1.  Inicia la detección en el panel (sección 02) y comparte la ventana de 2XKO.
2.  Deja activado el interruptor **Registro automático de resultados** (sección 03).
3.  Cuando aparezca la pantalla de resultado, el lector busca VICTORY / DEFEAT / WINS en la banda central. Dos lecturas seguidas del mismo veredicto registran la partida automáticamente, con un enfriamiento de 10 segundos para evitar duplicados.
4.  La overlay muestra el aviso ✓ VICTORIA o ✕ DERROTA, y el historial marca la partida como AUTO.
5.  Si registró algo mal, pulsa **Deshacer última partida**: revierte marcador, racha, historial y estadísticas por personaje.

El registro automático funciona solo mientras el detector esté encendido y la ventana del panel visible. Los botones manuales y el control móvil siguen funcionando igual.

### Selección automática de personajes (auto-mains)

Con el interruptor **Aplicar mains automáticamente**, cuando el detector confirma tu equipo en pantalla, esos personajes se guardan solos como tus mains y aparecen en la overlay. También puedes seguir editándolos a mano.

### Detección de rivales

El lector examina el lado contrario del HUD y muestra el equipo rival en la fila **RIVALES** de la overlay y en la vista previa del panel. Cada partida del historial guarda contra quién jugaste.

### Estadísticas por personaje

Cada partida registrada suma una victoria o derrota a los personajes detectados en tu equipo. La sección **Rendimiento por personaje** del panel muestra el récord y el win rate de cada uno.

## Detección de personajes de 2XKO

1.  Abre el panel en Chrome o Edge.
2.  Guarda `2XKO` como juego activo.
3.  En **Detección automática**, selecciona el lado en el que aparece tu jugador: izquierda o derecha.
4.  Pulsa **Iniciar detección**.
5.  En el selector de Chrome/Edge, comparte la ventana de 2XKO (no la ventana del panel).
6.  Usa las vistas de diagnóstico (tu equipo, rivales y zona de resultado) para comprobar que los recortes toman las zonas correctas.
7.  Cuando el mismo equipo se reconozca en dos lecturas consecutivas, los nombres se guardan y aparecen en la fila **EN PARTIDA** de la overlay.

El detector busca los nombres del roster jugable de 2XKO (incluyendo Sett y Samira). Es experimental: cambios de resolución, escalado, idioma, HUD o elementos que tapen las etiquetas pueden afectar al OCR. Las zonas de lectura se ajustan en las constantes `HUD_CROP` y `RESULT_ZONE` al inicio de `public/dashboard.js` (proporciones del ancho y alto de la ventana compartida).

### Privacidad de la captura

La captura se procesa en el navegador del propio equipo mediante Tesseract.js. No se graba, no se guarda en disco y los fotogramas no se envían al servidor local del overlay; únicamente se envían los nombres detectados y el resultado de la partida para actualizar el marcador. La librería y el modelo OCR sí se descargan desde CDN durante la primera carga.

## Retratos y selección visual de mains

*   La selección de mains incluye una galería con los retratos PNG de `Lycan-ve/Hot-Coffee-Frontend/public/fighters`.
*   Los retratos aparecen junto al nombre tanto en el panel y su vista previa como en la Browser Source de OBS.
*   La selección admite hasta tres mains y sincroniza el campo de texto, para que también puedas escribir los nombres manualmente.
*   Los PNG se cargan desde `raw.githubusercontent.com` usando las imágenes públicas de tu repositorio. Se necesita conexión a internet para que aparezcan; si alguna imagen no carga, el nombre sigue visible.

## Qué incluye v0.5

*   Perfiles independientes para 2XKO, Mortal Kombat 1 y Guilty Gear Strive.
*   Un tema visual distinto por juego, con cambio automático.
*   Marcador W/L, win rate y racha por juego.
*   Hasta tres mains editables por perfil, con aplicación automática opcional.
*   Botones manuales para victoria y derrota, más control desde el teléfono.
*   Registro automático de resultados por OCR con enfriamiento y botón de deshacer.
*   Detección de tu equipo y del equipo rival desde la captura de la ventana compartida.
*   Historial de partidas con equipo, rivales y origen (AUTO o MANUAL).
*   Estadísticas W/L y win rate por personaje.
*   Posición, tamaño y opacidad configurables.
*   Persistencia local en `data.json`.

## Limitaciones conocidas

La detección automática de resultados depende del texto de la pantalla final de 2XKO: si el juego cambia de interfaz, idioma o resolución, puede fallar o leer mal; por eso existe el enfriamiento, el aviso de "posible resultado" y el botón de deshacer. La detección de personajes y resultados funciona solo con 2XKO en esta versión; Mortal Kombat 1 y Guilty Gear Strive mantienen selección y registro manuales.

## Roster de 2XKO

La lista se basa en la galería oficial de campeones y en las notas oficiales del parche 1.3.3 del 27 de octubre de 2026, que añadieron Sett y Samira.

## Control desde el teléfono

1.  Conecta el PC y el teléfono a la misma red Wi‑Fi.
2.  Ejecuta `start.bat` en el PC.
3.  En el dashboard del PC (`http://127.0.0.1:3000/dashboard`) encontrarás la dirección local y el código de conexión de seis dígitos.
4.  Abre esa dirección en el navegador del teléfono, introduce el código y pulsa Conectar.
5.  Usa VICTORIA o DERROTA; el marcador de OBS se actualiza en tiempo real.

El servidor escucha en la red local para permitir el acceso móvil. El código cambia cada vez que reinicias el servidor. No compartas la dirección ni el código fuera de tu red de confianza. Si Windows Firewall pregunta, permite el acceso en redes privadas.