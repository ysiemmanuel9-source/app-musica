# Emmanuel Music App

Base profesional de una app musical tipo premium para iPhone, creada con Expo/React Native.

## Lo que incluye

- Marca y nombre: **Emmanuel**
- Foto principal incluida en `assets/emmanuel-photo.png`
- Inicio premium sin anuncios
- Busqueda real por cantante, musica y album usando Internet Archive
- Playlist propia
- Boton para guardar album completo en playlist
- Boton para descargar canciones, albumes completos o playlist completa
- Modo random, repetir, siguiente y pausa/play
- Reproduccion de MP3 online con `expo-av`
- Descarga offline local con `expo-file-system`
- Estado guardado con `AsyncStorage`
- Biblioteca local incluida en `assets/music`
- Autodescarga al abrir la app: las canciones del repo se guardan solas para modo offline
- Background audio configurado para iOS con `UIBackgroundModes: audio`
- Configuracion preparada para compilar iOS como `.ipa`

## Importante sobre musica y descargas

La app ahora usa tu biblioteca local de `assets/music` como fuente principal. Aun asi, antes de publicar comercialmente debes revisar que tienes permiso para distribuir cada pista. Para musica comercial de artistas famosos necesitas una de estas opciones:

- usar musica propia;
- conectar una biblioteca de audios con licencia;
- usar una API/licencia comercial de streaming;
- permitir que el usuario importe archivos que ya posee.

La base ya deja listo el flujo completo para buscar, reproducir, guardar y descargar audios. Si luego consigues un proveedor con licencia, solo hay que cambiar la funcion `fetchArchiveAlbums` o el manifiesto `src/localMusic.js`.

## Probar en desarrollo

```bash
npm install
npm start
```

Luego abre la app con Expo Go o con un simulador.

## Crear IPA

Para generar un `.ipa` necesitas una cuenta de Apple Developer y configurar EAS:

```bash
npm install
npx eas login
npx eas build:configure
npx eas build --platform ios
```

El comando creara el archivo instalable para iPhone desde la nube de Expo.

## GitHub Actions para IPA

El workflow esta en `.github/workflows/ios-ipa.yml`. Para que genere el IPA desde GitHub Actions debes agregar este secreto en el repo:

```text
EXPO_TOKEN
```

Luego entra a **Actions > Build iOS IPA > Run workflow**. EAS pedira la configuracion de Apple Developer si la cuenta no esta configurada.

## Subir a GitHub

```bash
git init
git add .
git commit -m "Create Emmanuel music app"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/emmanuel-music-app.git
git push -u origin main
```

## Siguientes pasos recomendados

1. Conectar un backend para usuarios, playlists y biblioteca.
2. Agregar archivos de audio reales con licencia.
3. Guardar descargas con `expo-file-system`.
4. Agregar autenticacion y perfiles.
5. Crear pantalla de album/artista con biografia, canciones y boton de descarga completa.
