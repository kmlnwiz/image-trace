"use strict";

// Six tools each carried their own copy of the same IndexedDB font store. They
// all wrote to one database under different keys, so the only thing that ever
// differed was the key — that is the single argument here.
(function exposeMotionFonts() {
  const DATABASE_NAME = "motion-lab-assets";
  const STORE_NAME = "fonts";
  const MAX_FONT_BYTES = 30 * 1024 * 1024;

  function openFontDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB is unavailable"));
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.addEventListener("upgradeneeded", () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
  }

  function createFontStore(assetKey) {
    async function write(asset) {
      const database = await openFontDatabase();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(asset, assetKey);
        transaction.addEventListener("complete", resolve);
        transaction.addEventListener("error", () => reject(transaction.error));
      });
      database.close();
    }

    async function read() {
      const database = await openFontDatabase();
      const asset = await new Promise((resolve, reject) => {
        const request = database.transaction(STORE_NAME, "readonly")
          .objectStore(STORE_NAME).get(assetKey);
        request.addEventListener("success", () => resolve(request.result || null));
        request.addEventListener("error", () => reject(request.error));
      });
      database.close();
      return asset;
    }

    async function remove() {
      try {
        const database = await openFontDatabase();
        await new Promise((resolve, reject) => {
          const transaction = database.transaction(STORE_NAME, "readwrite");
          transaction.objectStore(STORE_NAME).delete(assetKey);
          transaction.addEventListener("complete", resolve);
          transaction.addEventListener("error", () => reject(transaction.error));
        });
        database.close();
      } catch {
        // There may be no stored font to remove.
      }
    }

    return { read, write, remove };
  }

  // Loads a font file into the document and returns the generated family name.
  async function registerFontFile(buffer, prefix = "MotionLabLocal") {
    const family = `${prefix}${Date.now()}`;
    const font = new FontFace(family, buffer);
    await font.load();
    document.fonts.add(font);
    return family;
  }

  window.MotionFonts = { createFontStore, registerFontFile, MAX_FONT_BYTES };
})();
