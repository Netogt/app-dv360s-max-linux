declare module "gifuct-js" {
  export interface GifFrame {
    dims: { width: number; height: number; top: number; left: number };
    patch: Uint8ClampedArray;
    /** milissegundos */
    delay: number;
    disposalType: number;
  }
  export interface ParsedGif {
    lsd: { width: number; height: number };
  }
  export function parseGIF(buf: ArrayBuffer): ParsedGif;
  export function decompressFrames(gif: ParsedGif, buildImagePatches: boolean): GifFrame[];
}
