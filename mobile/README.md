# 📱 Yoru Reader — Mobile Version (Android / iOS)

Esta carpeta contiene todo el entorno, configuración, scripts de compilación y empaquetado dedicados exclusivamente a la versión móvil de **Yoru Reader**.

---

## 📂 Estructura de la Versión Móvil

```text
mobile/
├── releases/             # Archivos APK listos para instalar en Android
├── scripts/              # Scripts automatizados de compilación y sincronización
│   ├── build-android.js  # Script para compilar frontend y generar APKs
│   └── sync-mobile.js    # Script para sincronizar assets con Capacitor
├── capacitor.config.json # Configuración de Capacitor para plataformas móviles
└── README.md             # Esta documentación
```

---

## 🚀 Comandos Rápidos

Desde la raíz del proyecto (`Yoru-Reader`):

| Comando | Descripción |
| :--- | :--- |
| `npm run mobile:build` | Compila el frontend y sincroniza los assets con el proyecto nativo de Android. |
| `npm run mobile:open` | Abre el proyecto nativo de Android en **Android Studio**. |
| `npm run mobile:apk` | Compila el frontend y genera el archivo `.apk` directamente en `mobile/releases/`. |
| `npm run mobile:sync` | Sincroniza los cambios del código web con la app nativa móvil. |

---

## 📱 Características Móviles

1. **Gestos Táctiles Optimizados**:
   * Paginación por toques en bordes laterales o deslizamiento (swipe).
   * Menú contextual de lectura accesible con toque simple en el centro de la pantalla.
2. **Diccionarios 100% Offline (IndexedDB)**:
   * Almacenamiento local optimizado para bajo consumo de batería y memoria RAM.
3. **Modo Vertical (縦書き) y Horizontal Adaptable**:
   * Orientación bloqueable o ajustable según la rotación de la pantalla del teléfono.
4. **Google Drive Cloud Sync**:
   * Sincronización continua de progreso y biblioteca entre tu PC y tu teléfono móvil.
