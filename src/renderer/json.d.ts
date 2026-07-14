// Vite parses JSON imports at build time; typing them as unknown keeps tsc
// from loading the 800 KB bundled world map into the type checker.
declare module '*.json' {
  const value: unknown
  export default value
}
