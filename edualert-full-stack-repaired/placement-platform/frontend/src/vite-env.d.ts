/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Backend ORIGIN only, e.g. http://localhost:4000 (no trailing /api). Leave unset to use the dev proxy / same-origin /api. */
  readonly VITE_API_URL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
