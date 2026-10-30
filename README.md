# roadmap-monitor

Mod de Claude Code: una vista lateral dividida en dos partes.

- **Roadmap:** las etapas con su avance y el detalle de la etapa actual. Se detecta solo en cada sesión: primero el plan de la sesión y, si no hay, un roadmap del repo (`ROADMAP.md`, `docs/roadmap.md`...).
- **Monitor:** el trabajo en curso: agentes con avatar y actividad, tareas, tokens por agente, tarea e ítem del roadmap, y límites de uso o costo de la API.

Los gráficos y avatares se ven en VS Code y en la app de escritorio; en la terminal se muestra una versión de texto.

## Instalación

En la terminal de Claude Code:

```
/plugin install roadmap-monitor --marketplace jlefernandez/mod-roadmap-monitor
```

Responde `y` para agregar el marketplace y elige el alcance de la instalación.

## Uso

Abre la vista con el comando `/roadmap`.
