// `.ttf?url&ttf`: the TTF itself as a URL, never the WOFF2 twin (see assets.ts); vite/client only types `*?url`
declare module '*.ttf?url&ttf' {
  const url: string
  export default url
}
