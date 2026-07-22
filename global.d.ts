/**
 * Minimal Tableau Extensions API type surface used by this extension.
 * The client accesses window.tableau dynamically, so these are light.
 */
export {};

declare global {
  interface Window {
    tableau?: any;
  }
}
