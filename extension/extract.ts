import { extractPage } from '../shared/extract';

// The service worker injects this bundle only after Chrome has granted access
// to a tab. An explicit global survives the separate executeScript call that
// invokes extraction in the same isolated world.
(globalThis as typeof globalThis & { MarginExtractor?: { extractPage: typeof extractPage } }).MarginExtractor = { extractPage };
