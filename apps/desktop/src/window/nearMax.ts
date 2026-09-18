import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalSize } from "@tauri-apps/api/dpi";

/** 0.3.0 : ~1 mm (4 px) entre la fenêtre et chaque bord de l'écran.
La fenêtre n'entre JAMAIS en état « maximisé » — les transitions
maximisé ↔ plein écran laissaient un artefact DWM (liseré blanc) en
bas de l'écran. */
export const EDGE_MARGIN = 4;

export async function applyNearMax(): Promise<void> {
  try {
    const win = getCurrentWindow();
    if (await win.isMaximized()) await win.unmaximize();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const monitor = await (win as any).primaryMonitor();
    if (!monitor) return;
    const wa = monitor.workArea;
    await win.setSize(
      new PhysicalSize(wa.size.width - EDGE_MARGIN * 2, wa.size.height - EDGE_MARGIN * 2)
    );
    await win.center();
  } catch {
    // best-effort
  }
}