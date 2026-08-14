# Rover 3D Web

Laboratorio web 3D del rover de David Farfán. El proyecto usa **Three.js** para la visualización y **Rapier 3D** para la física del vehículo.

## Estado actual

- Modelo GLB V2 con jerarquía de ruedas, dirección y suspensión.
- Control vehicular físico mediante ray casting de Rapier.
- Tracción, frenado y dirección en las cuatro ruedas.
- Terreno marciano continuo con lomas, depresiones y rugosidad para observar la suspensión.
- Una misma malla triangular se utiliza para la representación visual y las colisiones.
- Telemetría de velocidad, contactos y compresión.
- Cámara de seguimiento y cámara orbital.

## Estabilidad de la simulación

- La física se calcula a **120 Hz** mediante pasos de tiempo fijos.
- El chasis no puede entrar en reposo automático mientras la experiencia está abierta.
- Cualquier control de conducción despierta explícitamente el cuerpo físico.
- La detección continua de colisiones (CCD) reduce penetraciones al atravesar obstáculos.
- La dirección máxima disminuye con la velocidad para reducir vuelcos poco realistas.
- El reinicio limpia velocidad, giro, fuerzas, frenos y estado visual de la suspensión.

El vehículo actual utiliza un controlador de ruedas por **ray casting**: cada rueda física
es un rayo con suspensión, agarre y contacto, mientras que el mecanismo completo del GLB
se anima visualmente. Es estable y apropiado para una experiencia web interactiva, pero no
es una simulación mecánica exacta de cada rótula, varilla y rodamiento. Para validar el diseño
real se necesitaría un modelo multicuerpo con sólidos, masas, centros de gravedad y juntas
medidos.

## Ejecutar en tu computadora

Necesitas [Node.js](https://nodejs.org/) 20 o posterior.

```bash
npm install
npm run dev
```

Vite mostrará una dirección local, normalmente `http://localhost:5173`.

## Controles

| Tecla | Acción |
| --- | --- |
| `W` / `S` | Avanzar / retroceder |
| `A` / `D` | Dirección en las cuatro ruedas |
| `C` | Cambiar entre seguimiento y órbita |
| `R` | Reiniciar el rover |

## Compilar

```bash
npm run build
```

La versión publicable se genera en `dist/`. Vercel detecta automáticamente el proyecto Vite.

## Próximas etapas

1. Calibrar masa, fuerza, agarre y recorrido de suspensión.
2. Ajustar la correspondencia exacta entre los rayos físicos y el mecanismo visual del GLB.
3. Crear la experiencia visual inspirada en JPL: modo Explorar, modo Conducir e información de componentes.
