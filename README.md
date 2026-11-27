# Fighting Overlay OBS — v0.11

Overlay y tracking local para OBS: marcador W/L, win rate, racha, historial de partidas, estadísticas y **detección automática por OCR** en 2XKO, Guilty Gear Strive y Mortal Kombat 11. Cada juego tiene su propio tema visual, y los mains y personajes detectados muestran retratos: iconos locales incluidos en `public/Assest` para Guilty Gear Strive y retratos del repositorio Hot-Coffee-Frontend para 2XKO (en MK11 el HUD no muestra personajes, así que se usan gamertags; sus iconos usan IDs numéricos y se activan rellenando `public/Assest/MK 11/names.json`).

## Temas por juego

La overlay cambia sola de diseño según el juego activo, también en la vista previa del panel. Los temas están afinados con los HUD reales de cada juego:

*   **2XKO** — tema ámbar de la escena del canal: bordes dorados redondeados, acento verde azulado a oro, tipografía Barlow Condensed.
*   **Mortal Kombat 11** — oro y sangre: fondo bronce oscuro, borde dorado, acento oro a rojo y tipografía épica Cinzel, como el marco dorado de su HUD.
*   **Guilty Gear Strive** — negro, blanco y rosa: fondo negro, borde blanco, barra lateral magenta y tipografía Chakra Petch inclinada, como el HUD de GGST.

Los temas viven en `public/themes.css`, el pulido visual compartido (profundidad, tipografía Barlow Condensed y micro-animaciones) en `public/overlay-polish.css`, que se carga entre `styles.css` y `themes.css`, y los acabados HUD de cada juego (barras de color, marcos biselados y cortes diagonales inspirados en las escenas del canal) en `public/themes-hud.css`, que se carga después de `themes.css`.

## Requisitos

*   Windows 10/11 (también puede ejecutarse en macOS/Linux con Node.js).
*   Node.js 18 o superior.
*   OBS Studio.
*   Chrome o Edge actualizado para la detección por captura de pantalla.
*   Conexión a internet la primera vez que se inicia el OCR (descarga Tesseract.js y el modelo de inglés desde CDN).

## Iniciar el proyecto

1.  Descarga o clona este repositorio en una carpeta.
2.  Si ya usabas una versión anterior, tu archivo `data.json` se conserva y se migra automáticamente (incluyendo MK1 → MK11).
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
5.  Activa el fondo transparente si OBS muestra esa opción. Si OBS conserva una vista anterior, pulsa **Actualizar caché de la página actual** en las propiedades de la fuente de navegador.
6.  Mueve la fuente por encima del juego y ajusta posición/tamaño desde el panel web. La posición "abajo centro" queda libre en los tres juegos: en GGST los medidores de tensión ocupan las esquinas inferiores y en MK11 los marcos decorativos quedan a los costados.

## Tracking (v0.6)

Para cada juego se guarda por separado:

*   **Victorias, derrotas, win rate y racha** de la sesión.
*   **Resumen de HOY**: partidas del día con win rate.
*   **Historial**: últimas 60 partidas con tu personaje (o el rival en MK11), la hora y el origen (AUTO o MANUAL).
*   **Rendimiento por personaje**: W/L y win rate por personaje detectado.
*   **Sesión automática (v0.9)**: el marcador puede reiniciarse solo cada día o tras un tiempo sin partidas; se configura en el panel.

El registro puede ser manual (botones del panel o del teléfono), automático por OCR, o mixto: la detección solo anota los personajes y tú registras el resultado.

## Detección automática por OCR (los tres juegos)

Con la detección activa, el panel alterna la lectura entre tres zonas de la ventana compartida: tu lado del HUD, el lado del rival y la zona central de resultado.

**Fuente de captura (v0.10):** en el panel eliges de dónde lee el detector. Además de compartir la ventana del juego, puedes usar la **cámara virtual de OBS**: activa en OBS el botón Iniciar cámara virtual y elige esa opción; así el detector lee la captura que OBS ya hace para tu transmisión, sin compartir la ventana en el navegador (ahorra FPS mientras emites). El panel pedirá permiso de cámara una sola vez para poder encontrar la cámara virtual. Además, el detector salta las lecturas cuando la pantalla no cambia, para gastar menos CPU.

1.  Guarda el juego activo en el panel.
2.  Pulsa **Iniciar detección** y comparte la ventana del juego en el selector de Chrome/Edge.
3.  Usa las vistas de diagnóstico para comprobar que los recortes toman las zonas correctas.
4.  En 2XKO y GGST, tu personaje o equipo aparece en la fila **EN PARTIDA**, el rival en **RIVALES**.
5.  En la pantalla de resultado, dos lecturas seguidas registran la partida automáticamente (con enfriamiento de 10 segundos).
6.  Si registró algo mal, pulsa **Deshacer última partida**.

### Tracking por API para GGST (v0.11): sin captura ni OCR

Para Guilty Gear Strive existe una vía mejor que la captura: la API de replays del propio juego. El proyecto incluye un helper en `tools/ggst-token` que, con Steam abierto y GGST instalado, genera un token de sesión (requiere tener [Go](https://go.dev/dl/) instalado y ejecutar `ggst-token.bat` una vez). Con el token y el Player ID pegados en el panel, el servidor sondea tu historial de replays cada 20 segundos y registra automáticamente victorias, derrotas, tu personaje y el rival, con la fuente AUTO en el historial. No hay captura de pantalla, no hay OCR y no consume FPS. La primera conexión marca tu historial actual como ya conocido, así que solo cuentan las partidas que juegues a partir de conectar. El token se guarda en `data.json` de tu equipo y caduca cuando lo caduca el servidor del juego: si el panel avisa, vuelve a ejecutar el helper. La API es no oficial y puede cambiar con parches.

### Modo automático total (v0.9)

En la sección de tracking del panel puedes activar **Detectar el juego automáticamente**: con la detección activa, el lector reconoce si estás jugando a 2XKO, Guilty Gear Strive o Mortal Kombat 11 por el texto del HUD y cambia el juego activo (y el tema de la overlay) sin pulsar nada. El registro de resultados, los personajes y los rivales siguen leyéndose solos, y los mains pueden guardarse solos con **Aplicar mains automáticamente**.

Junto al registro automático se elige el **reinicio del marcador de sesión**: manual (nunca se reinicia solo), cada día (vuelve a cero con la primera partida del día) o por inactividad (vuelve a cero tras X minutos sin partidas, configurable de 1 a 720 minutos).

Los navegadores solo permiten compartir la pantalla con una confirmación por sesión del panel: abre el panel, pulsa **Iniciar detección** una vez y comparte la ventana del juego; a partir de ahí, todo el tracking funciona solo.

### Cómo detecta cada juego

La configuración está en `GAME_DETECT`, al inicio de `public/dashboard.js`: modo, roster, tamaño de equipo, recortes del HUD y de la zona de resultado, y palabras clave. Son proporciones del ancho y alto de la ventana compartida.

*   **2XKO** (modo roster): equipos de 2 (Point + Assist) leyendo las etiquetas superiores. Resultado por VICTORY / DEFEAT / WINS.
*   **Guilty Gear Strive** (modo roster): 1 personaje, leyendo el nombre junto al retrato en la esquina superior (GIOVANNA, NAGORIYUKI, ...). Resultado por WIN / LOSE.
*   **Mortal Kombat 11** (modo etiquetas): el HUD de MK11 no muestra personajes, solo gamertags. El lector lee tu etiqueta (por ejemplo "MarineMorBius") y la del rival ("Fuzzboy73") en las esquinas superiores, y cuando aparece el banner "ETIQUETA WINS" atribuye la victoria o derrota comparando con las etiquetas. El rival queda registrado en el historial y en la fila RIVALES por su gamertag.

Si el banner aparece antes de leer las dos etiquetas, la partida no se registra sola (evita atribuir mal); registra a mano en ese caso.

### Rosters

El detector busca los nombres del roster de cada juego (2XKO hasta Sett y Samira del parche 1.3.3; GGST hasta Unika y Lucy; MK11 completo con DLC). Los nombres no reconocidos se descartan, así el OCR "ruidoso" no contamina el tracking. En MK11 el roster sirve para elegir mains a mano.

### Privacidad de la captura

La captura se procesa en el navegador del propio equipo mediante Tesseract.js. No se graba, no se guarda en disco y los fotogramas no se envían al servidor local del overlay; únicamente se envían los nombres detectados y el resultado de la partida. La librería y el modelo OCR se descargan desde CDN durante la primera carga.

## Retratos y selección visual de mains

*   El picker de mains muestra el roster del juego activo; los retratos PNG existen para el roster de 2XKO (`Lycan-ve/Hot-Coffee-Frontend/public/fighters`), los demás juegos muestran el nombre.
*   La selección admite hasta tres mains y sincroniza el campo de texto.
*   Con **Aplicar mains automáticamente**, lo que detecta el OCR se guarda como tus mains.

## Limitaciones conocidas

La detección automática depende del texto y la geometría del HUD de cada juego: resolución, escalado, idioma o interfaces distintas pueden hacerla fallar. Por eso existe el enfriamiento, el aviso de "posible resultado", el botón de deshacer y las zonas ajustables. En MK11 el idioma de las etiquetas no importa (son gamertags), pero la ventana debe mostrarse sin escalado raro para que el OCR lea bien.

## Control desde el teléfono

1.  Conecta el PC y el teléfono a la misma red Wi‑Fi.
2.  Ejecuta `start.bat` en el PC.
3.  En el dashboard del PC encontrarás la dirección local y el código de conexión de seis dígitos.
4.  Abre esa dirección en el navegador del teléfono, introduce el código y pulsa Conectar.
5.  Usa VICTORIA o DERROTA; el marcador de OBS se actualiza en tiempo real.

El servidor escucha en la red local para permitir el acceso móvil. El código cambia cada vez que reinicias el servidor. No compartas la dirección ni el código fuera de tu red de confianza. Si Windows Firewall pregunta, permite el acceso en redes privadas.