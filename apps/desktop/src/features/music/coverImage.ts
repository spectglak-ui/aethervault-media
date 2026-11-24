/**
 * Image choisie par l'utilisateur pour une playlist : recadrée au centre en CARRÉ puis réduite
 * (320 × 320, JPEG) pour rester légère dans la base (≈ 30 Ko). Renvoie une data URL.
 */
export async function squareJpegDataUrl(file: File, size = 320, quality = 0.85): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Ce fichier n'est pas une image.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Image trop lourde (25 Mo maximum).");
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Impossible de traiter l'image.");
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    bitmap.close();
  }
}
