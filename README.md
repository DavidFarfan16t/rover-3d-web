# Rover 3D Web

Laboratorio web 3D del rover de David Farfán. El proyecto usa **Three.js** para la visualización y **Rapier 3D** para la física del vehículo.

## Estado actual

- Modelo GLB V2 con jerarquía de ruedas, dirección y suspensión.
- Control vehicular físico mediante ray casting de Rapier.
- Tracción, frenado y dirección en las cuatro ruedas.
- Obstáculos alternados para observar el trabajo de cada lado de la suspensión.
- Telemetría de velocidad, contactos y compresión.
- Cámara de seguimiento y cámara orbital.

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
