/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' when built for GitHub Pages, where there is no server and no sign-in. */
  readonly VITE_STATIC_MODE?: string;
  /** owner/repo, set by the Pages workflow so the studio can link to the upload page. */
  readonly VITE_REPOSITORY?: string;
  /** Branch the Pages workflow built from. */
  readonly VITE_BRANCH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
