// What the build puts before the worker's code (integrations/service-worker.js).

/** The URL of every file the build made that a page may load. */
declare const FILES: string[];
/** Their version: a hash of their paths and contents. */
declare const VERSION: string;
