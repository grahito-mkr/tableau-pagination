/**
 * The site's root route ("/"). This is NOT what Tableau loads — the
 * extension's actual manifest (public/tableau-extension.trex) points at
 * "/extension", i.e. app/extension/page.tsx. This file used to be a
 * full separate copy of that page, which silently drifted out of date
 * every time the extension page changed (missing periodMatch, missing
 * compactPacking, old styling, ...). To make that class of bug impossible
 * going forward, "/" simply re-exports the same component — there is now
 * only one page to ever edit: app/extension/page.tsx.
 */
export { default } from "./extension/page";