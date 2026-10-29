# Registro de cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [1.2.0] - 2026-10-29

### Eliminado

- Se retira la cuenta activa del pie: quedaba al lado de las barras de uso. El pie vuelve a ser el de la 1.0.1; para ver la cuenta, usa una `statusLine` propia.

## [1.1.0] - 2026-10-29

### Añadido

- El pie del prompt muestra la cuenta activa (email y, atenuada, organización) delante de las barras de uso. Con menos de 100 columnas se oculta la organización y se acorta el email; con menos de 80, la cuenta va en una línea encima de las barras.
