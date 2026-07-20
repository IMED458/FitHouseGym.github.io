'use strict';

/**
 * Money is handled as integer tetri (1 GEL = 100 tetri) everywhere past this
 * boundary. Plan prices are authored in whole GEL in Firestore; nothing
 * downstream is allowed to see a float.
 */

function gelToTetri(gel) {
  const amount = Number(gel);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid GEL amount: ${gel}`);
  }
  // Round through a scaled integer to dodge binary-float drift (e.g. 70.1*100).
  const tetri = Math.round(amount * 100);
  if (!Number.isSafeInteger(tetri)) {
    throw new Error(`GEL amount out of range: ${gel}`);
  }
  return tetri;
}

function tetriToGel(tetri) {
  const amount = Number(tetri);
  if (!Number.isInteger(amount)) {
    throw new Error(`Invalid tetri amount: ${tetri}`);
  }
  return amount / 100;
}

function formatGel(tetri) {
  return `${tetriToGel(tetri).toFixed(2)}₾`;
}

export { gelToTetri, tetriToGel, formatGel };
