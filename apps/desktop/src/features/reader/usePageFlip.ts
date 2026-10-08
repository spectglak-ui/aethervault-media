import { PageFlip } from "page-flip";
import { useCallback, useEffect, useRef } from "react";

interface UsePageFlipOptions {
  /** URLs ORIGINALES (une par page du livre). */
  images: string[];
  /** Manga : page 1 à droite, avance vers la gauche. */
  isRtl: boolean;
  /** false = détruit l'instance (changement de mode, chargement…). */
  active: boolean;
  /** Index ORIGINAL de la page de départ. */
  startPage?: number;
  /** Reçoit toujours des index ORIGINAUX (jamais ceux des moitiés). */
  onFlip?: (pageIndex: number) => void;
}

/**
 * 0.7.7 — moteur « page curl » (StPageFlip) + gestion des planches
 * horizontales en mode Double :
 *  - chaque image dont le ratio > 1.2 est découpée en moitié gauche /
 *    moitié droite (canvas → dataURL, mis en cache) ; les deux moitiés
 *    deviennent deux pages consécutives → en spread, elles s'affichent
 *    côte à côte et reconstituent la planche entière SANS étirement ;
 *  - calage de parité : avec showCover, une paire = (impair, pair) ; si
 *    une planche arrive sur un slot gauche pair, une page blanche
 *    invisible (BLANK_PAGE) est insérée pour realigner les paires ;
 *  - la page 0 (couverture) n'est jamais découpée ;
 *  - si le découpage échoue (canvas tainted, décodage…), repli :
 *    page entière + CSS object-fit: contain (letterbox, pas d'étirement) ;
 *  - tous les index échangés avec l'extérieur (onFlip, startPage)
 *    restent des index ORIGINAUX : la progression et les autres modes
 *    (simple/scroll) ne voient aucune différence.
 */

const LANDSCAPE_THRESHOLD = 1.2;
/** Page blanche invisible 1×1 (PNG transparent) pour le calage de paires. */
const BLANK_PAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/* Caches module : le RTL/re-mount ne re-sonde ni ne re-découpe rien. */
const ratioCache = new Map<string, number>();
const halfCache = new Map<string, [string, string]>();

function probeRatio(url: string): Promise<number> {
  const cached = ratioCache.get(url);
  if (cached !== undefined) return Promise.resolve(cached);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const r = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
      ratioCache.set(url, r);
      resolve(r);
    };
    img.onerror = () => {
      ratioCache.set(url, 1);
      resolve(1);
    };
    img.src = url;
  });
}

async function splitHalves(url: string): Promise<[string, string] | null> {
  const cached = halfCache.get(url);
  if (cached) return cached;
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("load"));
      img.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;
    const halfW = Math.floor(w / 2);
    const draw = (sx: number): string | null => {
      const canvas = document.createElement("canvas");
      canvas.width = halfW;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, sx, 0, halfW, h, 0, 0, halfW, h);
      return canvas.toDataURL("image/jpeg", 0.92);
    };
    const left = draw(0);
    const right = draw(halfW);
    if (!left || !right) return null;
    const pair: [string, string] = [left, right];
    halfCache.set(url, pair);
    return pair;
  } catch {
    /* canvas tainted ou décodage impossible → pas de découpage */
    return null;
  }
}

interface DisplayPlan {
  /** URLs dans l'ordre D'AFFICHAGE (moitiés incluses, ordre RTL appliqué). */
  display: string[];
  /** index affiché → index original. */
  dispToOrig: number[];
  /** index original → premier index affiché correspondant. */
  origToDisp: number[];
}

async function buildDisplayPlan(urls: string[], isRtl: boolean): Promise<DisplayPlan> {
  const ratios = await Promise.all(urls.map(probeRatio));
  const order = urls.map((_, i) => i);
  if (isRtl) order.reverse();

  const display: string[] = [];
  const dispToOrig: number[] = [];
  const origToDisp: number[] = new Array(urls.length).fill(-1);

  const push = (url: string, orig: number) => {
    if (origToDisp[orig] === -1) origToDisp[orig] = display.length;
    display.push(url);
    dispToOrig.push(orig);
  };

  for (const orig of order) {
    const isLandscape = ratios[orig] > LANDSCAPE_THRESHOLD;
    if (isLandscape && orig !== 0) {
      const halves = await splitHalves(urls[orig]);
      if (halves) {
        // showCover : paires = (1,2), (3,4)… → slot gauche = impair.
        if (display.length % 2 === 0) push(BLANK_PAGE, orig);
        push(halves[0], orig); // moitié gauche → slot gauche
        push(halves[1], orig); // moitié droite → slot droit
        continue;
      }
    }
    push(urls[orig], orig);
  }
  return { display, dispToOrig, origToDisp };
}

export function usePageFlip({
  images,
  isRtl,
  active,
  startPage = 0,
  onFlip,
}: UsePageFlipOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const flipRef = useRef<PageFlip | null>(null);
  const onFlipRef = useRef(onFlip);
  onFlipRef.current = onFlip;

  const imagesKey = images.length > 0 ? `${images.length}|${images[0]}|${isRtl}` : "";

  useEffect(() => {
    if (!active || images.length === 0) return;
    let destroyed = false;
    let instance: PageFlip | null = null;

    void (async () => {
      const plan = await buildDisplayPlan(images, isRtl);
      if (destroyed) return;
      requestAnimationFrame(() => {
        if (destroyed || !containerRef.current) return;
        // Le conteneur est remonté neuf par React (key côté page) :
        // aucune chirurgie DOM manuelle ici.
        const pf = new PageFlip(containerRef.current, {
          width: 600,
          height: 850,
          size: "stretch",
          minWidth: 280,
          maxWidth: 1600,
          minHeight: 300,
          maxHeight: 2000,
          showCover: true,
          maxShadowOpacity: 0.4,
          flippingTime: 650,
          usePortrait: false,
          drawShadow: true,
          mobileScrollSupport: false,
          startPage: 0,
        });
        instance = pf;
        flipRef.current = pf;
        pf.loadFromImages(plan.display);
        pf.on("flip", (e: { data: number }) => {
          const v = typeof e.data === "number" ? e.data : 0;
          onFlipRef.current?.(plan.dispToOrig[v] ?? v);
        });
        const clamped = Math.min(Math.max(startPage, 0), images.length - 1);
        const target = plan.origToDisp[clamped];
        pf.turnToPage(target >= 0 ? target : 0);
      });
    })();

    return () => {
      destroyed = true;
      const pf = instance ?? flipRef.current;
      if (pf) {
        try {
          pf.destroy();
        } catch {
          /* déjà détruite */
        }
      }
      flipRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, imagesKey]);

  const flipNext = useCallback(() => {
    const pf = flipRef.current;
    if (!pf) return;
    if (isRtl) pf.flipPrev();
    else pf.flipNext();
  }, [isRtl]);

  const flipPrev = useCallback(() => {
    const pf = flipRef.current;
    if (!pf) return;
    if (isRtl) pf.flipNext();
    else pf.flipPrev();
  }, [isRtl]);

  return { containerRef, flipNext, flipPrev };
}