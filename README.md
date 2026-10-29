# uso-suscripcion

Mod de Claude Code que muestra el uso de tu suscripción mientras trabajas: las ventanas de 5 horas y semanal **a la vez**, cada una con su barra, su porcentaje y su hora de reinicio.

*A Claude Code mod that shows your subscription usage while you work: the 5-hour and weekly windows side by side, each with its bar, percentage and reset time.*

```
persona@ejemplo.com · Ejemplo S.L. · 5h ▓▓░░░░░░░░ 24% ↻17:00 · semana ▓▓▓▓▓▓▓▓░░ 87%! ↻jue. 17:00
```

Los datos de la línea son de ejemplo.

## Qué hace

- **Cuenta activa.** Delante de las barras aparece el email de la cuenta con la que has iniciado sesión y, atenuada, su organización, para saber de un vistazo qué perfil usas. Del email y la organización se descartan los caracteres de control e invisibles (incluidos los de dirección del texto) antes de mostrarlos. Con menos de 100 columnas se oculta la organización y el email se acorta por el medio; con menos de 80, la cuenta pasa a su propia línea encima de las barras. Si el perfil no tiene sesión de claude.ai guardada, no aparece. Ojo: se muestra la cuenta guardada en el perfil, aunque la sesión use una API key o un token de entorno. La cuenta no se guarda: se lee al empezar cada sesión. Se lee del `.claude.json` del perfil (`CLAUDE_CONFIG_DIR` o la carpeta personal) y solo se usan el email y la organización. El email se ve en pantalla; tenlo en cuenta al compartir pantalla.
- **Dos ventanas a la vez, sin alternar.** La de 5 horas (`5h`) y la semanal (`semana`) se ven siempre juntas, con su barra de diez tramos.
- **Color según el uso.** Verde por debajo del 50 %, amarillo desde el 50 % hasta el 79 % y rojo desde el 80 %. Desde el 80 % el porcentaje lleva además un `!`, para que el aviso no dependa solo del color.
- **Hora de reinicio.** `↻17:00` para la de 5 horas y `↻jue. 17:00` para la semanal. Cuando ya pasó la hora de reinicio, la ventana vuelve a 0 % y deja de mostrar «↻» (se revisa cada minuto).
- **Casos especiales.** Si falta una de las dos ventanas, aparece «–» en su lugar. El porcentaje tiene tope en 100 %.
- **Memoria entre sesiones.** Cada lectura se guarda, así que una sesión nueva muestra la última lectura hasta que llegue una fresca. Solo se guardan los porcentajes y las horas de reinicio, en el almacén local del plugin; no se envían a ningún sitio.
- **Sin suscripción, no aparecen las barras.** Sin una suscripción Pro o Max, o antes de la primera respuesta si no hay nada guardado, el mod no pinta las barras. Si hay cuenta, se ve solo la cuenta.

## Dónde se ve

Abajo a la derecha del pie del prompt, después de las etiquetas del modo de permisos. La cuenta va delante de las barras, en la misma fila (con menos de 80 columnas, en una línea encima). Si otro mod dibuja en la misma zona, como [contexto-tokens](https://github.com/wkielw2/claude-context-count), su contenido se conserva delante de las barras. No aparece en la fila de `statusLine`: un plugin no puede fijarla, porque su `settings.json` solo admite `agent` y `subagentStatusLine`.

## Instalación

```sh
claude plugin marketplace add wkielw2/warp-use-mod
claude plugin install uso-suscripcion@uso-suscripcion
```

Es un mod de *function hooks*, una API en acceso anticipado que puede cambiar entre versiones. Está probado con Claude Code 2.1.310.

Si tienes una status line propia que ya muestra el uso, o el mod `sub-meter@better-claude`, quítalos o desactívalos para no ver el uso dos veces. Si tu statusLine ya mostraba la cuenta, quítala también para no verla dos veces.

## Desarrollo

Desde la raíz del repositorio:

```sh
claude plugin validate .
claude plugin test .
```

- `hooks/uso.ts`: lógica pura (ventanas que llegan de la medición, niveles de color, barras, formato de la hora de reinicio; y la de la cuenta: ruta del `.claude.json`, saneado del email y la organización, recorte y disposición según el ancho). Tests en `tests/uso.test.ts`.
- `hooks/register.tsx`: lee las cuotas de la sesión y la cuenta al arrancar, guarda la última lectura de cuotas para la sesión siguiente y dibuja la línea en el pie del prompt. Tests en `tests/register.test.tsx`.

## Licencia

MIT © 2026 Jose Miniñi Diego. Ver [LICENSE](LICENSE). Incluye código basado en `sub-meter` de [midudev/better-claude](https://github.com/midudev/better-claude) (MIT), con su aviso en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
