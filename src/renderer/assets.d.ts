// Static assets imported by the renderer (bundled by Vite, served from 'self').
declare module '*?url' {
  const url: string;
  export default url;
}
declare module '*.png' {
  const url: string;
  export default url;
}
