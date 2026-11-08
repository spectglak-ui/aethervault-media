import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { armUiSounds, isUiSoundId, playUiSound, setUiSoundsDucked, type UiSoundId } from "./uiSounds";

/** Ce qui réagit au pointeur : boutons, liens, onglets, éléments de menu, résumés. */
const CLICKABLE =
  'button, a[href], [role="button"], [role="tab"], [role="menuitem"], summary, [data-sound]';
/** Ce qui mérite un tic de survol (en plus des boutons) : les cartes d'affiches. */
const HOVERABLE = `${CLICKABLE}, .avm-card`;

/**
 * Son associé à un élément cliquable, ou `null` (silence).
 * Ordre de priorité : `data-sound` explicite → rôle de l'élément → bouton par défaut.
 * `data-sound="none"` rend un élément muet (ex. boutons de test des Paramètres,
 * qui jouent leur propre son).
 */
export function soundForElement(el: Element): UiSoundId | null {
  const forced = el.closest<HTMLElement>("[data-sound]")?.dataset.sound;
  if (forced) return isUiSoundId(forced) ? forced : null;
  if (el.matches(':disabled, [aria-disabled="true"]')) return null;
  if (el.closest(".avm-nav-item")) return "nav";
  if (el.matches('[role="tab"], summary, .avm-chip')) return "select";
  if (el.matches(".avm-button--danger")) return "delete";
  if (el.matches(".avm-button--primary, button[type='submit']")) return "tap-primary";
  return "tap";
}

/**
 * Branche les sons d'interface sur toute l'application (à monter une fois,
 * dans l'AppShell) :
 *  - clic / pointeur sur boutons, liens, onglets… ; Entrée/Espace au clavier ;
 *  - cases à cocher, boutons radio et listes déroulantes (interrupteur on/off) ;
 *  - ouverture/fermeture des fenêtres de dialogue ;
 *  - messages d'erreur / de succès qui apparaissent ;
 *  - événements du backend : analyse terminée, erreur d'analyse, demande d'ami ;
 *  - `ducked` : volume réduit pendant une lecture vidéo/audio.
 */
export function useUiSounds({ ducked = false }: { ducked?: boolean } = {}) {
  useEffect(() => {
    setUiSoundsDucked(ducked);
  }, [ducked]);

  useEffect(() => {
    // Le moteur audio ne peut démarrer qu'après un geste de l'utilisateur.
    const arm = () => {
      armUiSounds();
      window.removeEventListener("pointerdown", arm, true);
      window.removeEventListener("keydown", arm, true);
    };
    window.addEventListener("pointerdown", arm, true);
    window.addEventListener("keydown", arm, true);

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      const el = event.target.closest(CLICKABLE);
      if (!el) return;
      const id = soundForElement(el);
      if (id) playUiSound(id);
    };

    // Clavier : Entrée/Espace sur un bouton ou lien focalisé (pas de pointerdown dans ce cas).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
      const active = document.activeElement;
      if (!active || !active.matches('button, a[href], [role="button"], [role="tab"], summary')) return;
      const id = soundForElement(active);
      if (id) playUiSound(id);
    };

    // Cases à cocher / radios / listes : le son dépend du nouvel état.
    const onChange = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement) {
        if (target.dataset.sound === "none") return;
        if (target.type === "checkbox") playUiSound(target.checked ? "toggle-on" : "toggle-off");
        else if (target.type === "radio") playUiSound("select");
      } else if (target instanceof HTMLSelectElement) {
        if (target.dataset.sound !== "none") playUiSound("select");
      }
    };

    let lastHover: Element | null = null;
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !(event.target instanceof Element)) return;
      const el = event.target.closest(HOVERABLE);
      if (!el || el === lastHover) return;
      lastHover = el;
      if (!el.matches(':disabled, [aria-disabled="true"]')) playUiSound("hover");
    };

    // Dialogues et messages qui apparaissent / disparaissent dans le DOM.
    const isDialog = (node: Node) =>
      node instanceof HTMLElement &&
      (node.matches('[role="dialog"], .avm-modal-backdrop') || !!node.querySelector('[role="dialog"]'));
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (isDialog(node)) playUiSound("open");
          else if (node.matches('[role="alert"], .avm-settings-error') && node.textContent?.trim()) playUiSound("error");
          else if (node.matches(".avm-settings-success") && node.textContent?.trim()) playUiSound("success");
        });
        record.removedNodes.forEach((node) => {
          if (isDialog(node)) playUiSound("close");
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("change", onChange, true);
    document.addEventListener("pointerover", onPointerOver, true);

    // Événements du backend (ignorés sans erreur hors Tauri).
    const unlisteners = [
      listen("library:scan-complete", () => playUiSound("success")),
      listen("library:scan-error", () => playUiSound("error")),
      listen("friends:requests-changed", () => playUiSound("notify")),
    ];

    return () => {
      window.removeEventListener("pointerdown", arm, true);
      window.removeEventListener("keydown", arm, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("pointerover", onPointerOver, true);
      observer.disconnect();
      for (const unlisten of unlisteners) void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, []);
}
