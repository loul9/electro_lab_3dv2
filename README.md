# Electro-Lab-3D

Laboratorio interactivo en 3D para aprender las partes de artefactos cotidianos y sus circuitos eléctricos, con **realidad aumentada**, **realidad virtual** y control por **gestos (MediaPipe)**.

Proyecto de Tecnología e Informática — MEN 2022.

![Estado](https://img.shields.io/badge/estado-listo%20para%20usar-brightgreen)
![HTML](https://img.shields.io/badge/HTML%20%2B%20Three.js-una%20sola%20p%C3%A1gina-orange)

## Demo

Abre `index.html` en el navegador. No requiere instalación, servidor ni compilación: todo (HTML, CSS, JavaScript, modelos `.glb` y texturas) está incrustado en un único archivo.

Para publicarlo en GitHub Pages:

1. Sube `index.html` a la raíz del repositorio.
2. Ve a **Settings → Pages** y selecciona la rama `main` y la carpeta `/ (root)`.
3. La página quedará disponible en `https://<usuario>.github.io/<repositorio>/`.

> Para AR/VR y cámara se necesita un contexto seguro (`https://` o `localhost`). Abierto como `file://` esas funciones quedan deshabilitadas automáticamente.

## Funcionalidades

- **Visor 3D** de artefactos con lista de partes y ficha informativa al hacer clic (ratón, etiquetas o pinza con la mano).
- **Realidad aumentada** (`immersive-ar`) con respaldo automático a **realidad virtual** (`immersive-vr`) mediante WebXR.
- **MediaPipe Hands**: navegación por gestos con la cámara del dispositivo.
- **Circuitos eléctricos** por artefacto, con explicación de cada componente.
- **Recomendaciones** de uso seguro y eficiencia energética.
- **Evaluación** de 20 preguntas con puntaje, retroalimentación y reinicio.
- Diseño **responsivo** con controles táctiles, interfaz tipo radio de gelatina y detalles de laboratorio (dial CometDial, linterna, etc.).

## Artefactos incluidos

Ventilador, bombillo/linterna, batería (fuente), timbre y otros artefactos del hogar. Cada uno con modelo 3D, partes seleccionables y esquema de circuito.

## Controles

| Acción | Cómo |
| --- | --- |
| Girar / acercar | Arrastrar y rueda del ratón (o dos dedos en móvil) |
| Seleccionar una parte | Clic en el modelo, en su etiqueta o en la lista lateral |
| AR / VR | Botón del visor (requiere WebXR y contexto seguro) |
| Gestos | Botón de cámara y pinza con los dedos |
| Cerrar la ficha | Botón ✕ de la tarjeta |

## Estructura

```
index.html                      Sitio completo (autocontenido)
index-backup-sin-autores.html   Copia de respaldo sin los círculos de autores de la portada
README.md
```

## Requisitos

- Navegador moderno con WebGL (Chrome, Edge, Firefox o Safari recientes).
- Para RA/RV: dispositivo compatible con WebXR (Android/Chrome, Quest, etc.).
- Para gestos: cámara y permiso de acceso.

## Autores

- Sebastián Mendoza
- Daniel Galezo

Proyecto educativo de Tecnología e Informática — MEN 2022.
