# Rover 3D Web

Laboratorio web 3D del rover de David Farfán. El proyecto usa **Three.js** para la visualización y **Rapier 3D** para la física del vehículo.

## Estado actual

- Modelo GLB V2 con jerarquía de ruedas, dirección y suspensión.
- Control vehicular físico mediante ray casting de Rapier.
- Tracción, frenado y dirección en las cuatro ruedas.
- Terreno marciano continuo con lomas, depresiones y rugosidad para observar la suspensión.
- Montículos estrechos alternados para elevar una sola rueda y probar la articulación lateral.
- Suspensión raycast de recorrido ampliado y mayor amortiguación para conservar los cuatro contactos.
- Ángulo visual del balancín calculado geométricamente según la distancia entre ejes.
- Una misma malla triangular se utiliza para la representación visual y las colisiones.
- Telemetría de velocidad, contactos y compresión.
- Cámara de seguimiento y cámara orbital.
- Mapa cenital del terreno con posición, orientación, ruta y recorrido del rover.
- Waypoints creados directamente con clic sobre el mapa.
- Programador visual por bloques: avanzar una distancia, girar un ángulo o ir a un waypoint.
- Piloto automático con Play, Pausa y Stop; la misión queda guardada en el navegador.

## Estabilidad de la simulación

- La física se calcula a **120 Hz** mediante pasos de tiempo fijos.
- El chasis no puede entrar en reposo automático mientras la experiencia está abierta.
- Cualquier control de conducción despierta explícitamente el cuerpo físico.
- La detección continua de colisiones (CCD) reduce penetraciones al atravesar obstáculos.
- La dirección máxima disminuye con la velocidad para reducir vuelcos poco realistas.
- La masa física se aproxima a 50 kg y el centro de masa está ligeramente rebajado para evitar caballitos.
- La fuerza de los motores entra mediante una rampa; no pasa instantáneamente de cero al máximo.
- La tracción está calibrada para **4 motores de 2,6 N·m** y una reducción **50:1**. Con una eficiencia estimada del 82 %, cada rueda dispone de unos **106,6 N·m** después de la caja.
- Con ruedas de 0,182 m de radio, el tren motriz podría producir teóricamente unos **586 N por rueda**. La simulación limita esa cifra a unos **123 N por rueda**, de acuerdo con la masa y el agarre, para evitar patinaje y vuelcos irreales.
- En terreno normal se usan 42 N por rueda. La reserva de par aumenta progresivamente hasta el límite de agarre cuando el rover apunta cuesta arriba o permanece casi detenido bajo aceleración.
- El piloto automático puede solicitar hasta el 78 % del acelerador cuando una pendiente reduce su velocidad; no depende de mantener pulsada la tecla `W` para usar la asistencia de subida.
- El piloto automático reduce su velocidad durante el último metro y aplica un freno progresivo antes de cada waypoint.
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

## Planificador de misión

El mapa usa el mismo sistema de unidades que la simulación:

- Cada cuadro pequeño representa **1 metro** y cada línea gruesa representa **5 metros**.
- El eje **X** indica el desplazamiento lateral; el eje **Z**, el desplazamiento longitudinal del campo. En el mapa, **norte corresponde a −Z** y aparece arriba; **sur corresponde a +Z** y aparece abajo.
- Al mover el cursor sobre el mapa se muestran sus coordenadas `X/Z` y la distancia en línea recta hasta el rover.
- Cada waypoint muestra sus coordenadas, y cada tramo de la ruta indica la distancia exacta en metros.

1. Haz clic sobre el mapa para crear uno o varios waypoints. Las coordenadas se guardan con precisión de 0,1 m. Con clic derecho sobre un waypoint puedes eliminarlo.
2. Construye el programa con los botones `+` de los bloques:
   - **Avanzar:** recorre la cantidad indicada de metros manteniendo el rumbo inicial del bloque.
   - **Girar:** usa grados positivos para girar a la derecha y negativos para girar a la izquierda. Por ejemplo, `90°` gira a la derecha y `−90°` gira a la izquierda.
   - **Ir a:** selecciona un waypoint y el rover corrige automáticamente su dirección hasta alcanzarlo.
3. Ordena los bloques con las flechas o elimínalos con `×`.
4. Pulsa **Play**. El rover vuelve al punto de inicio y ejecuta la secuencia completa.
5. **Pausa** conserva el bloque actual; **Stop** detiene y vuelve el programa al primer bloque.

Si se presiona `W`, `A`, `S` o `D` durante una misión, el piloto automático se pausa y entrega el control al usuario. El programa y los waypoints se conservan mediante `localStorage`.

## Compilar

```bash
npm run build
```

La versión publicable se genera en `dist/`. Vercel detecta automáticamente el proyecto Vite.

## Próximas etapas

1. Calibrar masa, fuerza, agarre y recorrido de suspensión.
2. Ajustar la correspondencia exacta entre los rayos físicos y el mecanismo visual del GLB.
3. Crear la experiencia visual inspirada en JPL: modo Explorar, modo Conducir e información de componentes.
