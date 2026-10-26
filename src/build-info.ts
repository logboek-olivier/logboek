// Bouwgegevens, door Vite ingevuld (vite.config.ts → define). In tests zonder Vite: "dev".

declare const __APP_VERSION__: string
declare const __BUILD_DATE__: string
declare const __COMMIT__: string

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
export const BUILD_DATE = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : ''
export const COMMIT = typeof __COMMIT__ === 'string' ? __COMMIT__ : 'dev'
