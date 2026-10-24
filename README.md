# uso-suscripcion

Mod de Claude Code que muestra el uso de tu suscripción mientras trabajas: las ventanas de 5 horas y semanal **a la vez**, cada una con su barra, su porcentaje y su hora de reinicio.

*A Claude Code mod that shows your subscription usage while you work: the 5-hour and weekly windows side by side, each with its bar, percentage and reset time.*

```
5h ▓▓░░░░░░░░ 24% ↻17:00 · semana ▓▓▓▓▓▓▓▓░░ 87%! ↻jue. 17:00
```

Los datos de la línea son de ejemplo.

## Qué hace

- **Dos ventanas a la vez, sin alternar.** La de 5 horas (`5h`) y la semanal (`semana`) se ven siempre juntas, con su barra de diez tramos.
- **Color según el uso.** Verde por debajo del 50 %, amarillo desde el 50 % hasta el 79 % y rojo desde el 80 %. Desde el 80 % el porcentaje lleva además un `!`, para que el aviso no dependa solo del color.
- **Hora de reinicio.** `↻17:00` para la de 5 horas y `↻jue. 17:00` para la semanal. Cuando ya pasó la hora de reinicio, la ventana vuelve a 0 % y deja de mostrar «↻» (se revisa cada minuto).
- **Casos especiales.** Si falta una de las dos ventanas, aparece «–» en su lugar. El porcentaje tiene tope en 100 %.
- **Memoria entre sesiones.** Cada lectura se guarda, así que una sesión nueva muestra la última lectura hasta que llegue una fresca. Solo se guardan los porcentajes y las horas de reinicio, en el almacén local del plugin; no se envían a ningún sitio.
- **Sin suscripción, no aparece nada.** Sin una suscripción Pro o Max, o antes de la primera respuesta si no hay nada guardado, el mod no pinta nada.

## Dónde se ve

Abajo a la derecha del pie del prompt, después de las etiquetas del modo de permisos. No aparece en la fila de `statusLine`: un plugin no puede fijarla, porque su `settings.json` solo admite `agent` y `subagentStatusLine`.

## Instalación

```sh
claude plugin marketplace add wkielw2/warp-use-mod
claude plugin install uso-suscripcion@uso-suscripcion
```

Es un mod de *function hooks*, una API en acceso anticipado que puede cambiar entre versiones. Está probado con Claude Code 2.1.310.

Si tienes una status line propia que ya muestra el uso, o el mod `sub-meter@better-claude`, quítalos o desactívalos para no ver el uso dos veces.

## Desarrollo

Desde la raíz del repositorio:

```sh
claude plugin validate .
claude plugin test .
```

- `hooks/uso.ts`: lógica pura (ventanas que llegan de la medición, niveles de color, barras, formato de la hora de reinicio). Tests en `tests/uso.test.ts`.
- `hooks/register.tsx`: lee las cuotas de la sesión, guarda la última lectura para la sesión siguiente y dibuja la línea en el pie del prompt. Tests en `tests/register.test.tsx`.

## Licencia

MIT © 2026 Jose Miniñi Diego. Ver [LICENSE](LICENSE). Incluye código basado en `sub-meter` de [midudev/better-claude](https://github.com/midudev/better-claude) (MIT), con su aviso en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
