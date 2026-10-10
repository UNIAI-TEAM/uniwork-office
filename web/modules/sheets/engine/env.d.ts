/** Vite asset URL imports used by the engine Worker (the build emits the file, hashed) */
declare module '*.wasm?url' {
  const url: string
  export default url
}
