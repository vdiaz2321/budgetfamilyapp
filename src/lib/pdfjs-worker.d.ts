// pdfjs-dist ships no types for its worker bundle. Importing it only registers
// globalThis.pdfjsWorker (used by ssa-statement-pdf.ts to run pdf.js on the
// main thread), so an empty module type is all that's needed.
declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
