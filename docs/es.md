# Google Encontrar mi dispositivo

## Presentación

Esta integración trae a Gladys los dispositivos de su cuenta de Google **Encontrar mi
dispositivo** (Find Hub): móviles y tabletas Android, y los rastreadores Bluetooth de la red Find
Hub (Chipolo, Pebblebee, Moto Tag, auriculares…).

Para cada dispositivo, Gladys recibe:

- **Posición**: el nombre del lugar o las coordenadas de la última posición;
- **En casa**: 1 cuando el dispositivo está dentro del radio de la casa, 0 si no;
- **Distancia de casa** (km) y **Precisión de la posición** (m);
- **Sonar**: un interruptor que hace sonar el dispositivo a todo volumen, incluso en modo
  silencio.

También añade:

- tres **disparadores de escena**: _Un dispositivo tiene una nueva posición_, _Un dispositivo
  llega a casa_, _Un dispositivo sale de casa_ (con el nombre del dispositivo, las coordenadas, la
  distancia y un enlace de Google Maps como variables);
- tres **acciones de escena**: _Localizar un dispositivo_ (devuelve la posición), _Hacer sonar un
  dispositivo_, _Detener la alarma de un dispositivo_;
- un **widget del panel** que lista sus dispositivos con los botones Localizar y Sonar.

Las posiciones están cifradas de extremo a extremo por Google: la integración las descifra dentro
de su Gladys, con sus propias claves. No van a ningún otro sitio.

## Requisitos previos

Google **no ofrece ninguna API pública** para Encontrar mi dispositivo. Esta integración usa la
misma API privada que la aplicación Encontrar mi dispositivo, tal como la describe el proyecto
libre [GoogleFindMyTools](https://github.com/leonboe1/GoogleFindMyTools). Google puede cambiarla en
cualquier momento.

Iniciar sesión requiere una ventana real de Chrome, así que se hace **una sola vez, en un
ordenador**:

1. Instale Python 3 y Google Chrome en un ordenador.
2. Descargue GoogleFindMyTools y, en su carpeta, ejecute `pip install -r requirements.txt` y
   `python main.py`.
3. Inicie sesión en su cuenta de Google en la ventana de Chrome que se abre.
4. Cuando aparezca la lista de dispositivos, **elija un dispositivo para localizar**: la
   herramienta pide el PIN (o el patrón) de bloqueo de uno de sus dispositivos Android. Esto
   desbloquea la clave de cifrado de sus posiciones (`owner_key`). Sin este paso, las posiciones no
   se pueden descifrar.
5. La herramienta escribe el archivo `Auth/secrets.json`. Ábralo con un editor de texto y copie
   **todo** su contenido.

Su casa de Gladys debe tener una ubicación (Ajustes → Casas) para la presencia y la distancia.

## Configuración

1. En Gladys, instale la integración y abra su pestaña **Configuración**.
2. Pegue el contenido de `secrets.json` en **Contenido de secrets.json** y guarde.
3. Opcional: elija la **Casa**, el **Radio de la casa** (150 m por defecto) y la frecuencia
   **Localizar cada** (15 minutos por defecto, `0` = solo a petición). Cada solicitud despierta los
   dispositivos: los intervalos muy cortos gastan batería.
4. Pulse **Probar la conexión**: muestra la cuenta, el número de dispositivos y el estado del canal
   push.
5. Vaya a la pestaña **Dispositivos** y añada los que quiera.

`secrets.json` da acceso a los dispositivos de su cuenta de Google: manténgalo en privado. Se
guarda en un campo secreto de Gladys (oculto en la interfaz) y nunca se escribe en los registros. Use un
`secrets.json` exclusivo para Gladys: si el mismo archivo se usa en otro sitio (Home Assistant…),
ambos compiten por el mismo canal push.

## Solución de problemas

- **«secrets.json está incompleto»**: vuelva a ejecutar GoogleFindMyTools hasta que liste sus
  dispositivos y pegue el nuevo archivo.
- **«Las posiciones no se pueden descifrar: secrets.json no tiene owner_key»**: en
  GoogleFindMyTools, localice un dispositivo (paso 4 anterior) y pegue el archivo actualizado.
- **«Google rechazó el token de la cuenta (BadAuthentication)»**: el token fue revocado (cambio de
  contraseña, control de seguridad de la cuenta). Borre `Auth/secrets.json`, vuelva a ejecutar
  GoogleFindMyTools y pegue el nuevo archivo.
- **Un dispositivo nunca responde**: debe estar encendido, conectado y con Encontrar mi
  dispositivo activado. Un rastreador solo se localiza cuando pasa cerca un móvil Android.
- **Distintivo «Canal push caído»**: Gladys no llega a `mtalk.google.com` en el puerto 5228 (TCP).
  Abra este puerto de salida en su cortafuegos.
- **Ni presencia ni distancia**: dé una ubicación a su casa de Gladys o elíjala en **Casa**.
