import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /**
   * Rend la boîte dans `document.body` : le fond `position: fixed` est alors centré dans la
   * FENÊTRE quoi que fassent les styles de la page appelante. À activer quand une règle de la
   * page vise ses enfants directs (ex. `.avm-title-page > * { position: relative }`, qui
   * écrasait le `fixed` du fond : le panneau tombait dans le flux, tout en bas de la page).
   */
  portal?: boolean;
}

/**
 * Boîte de dialogue générique (fermeture au clic sur le fond ou touche
 * Échap). Premier consommateur : le formulaire de création de bibliothèque
 * (Étape 2), mais volontairement sans rien de spécifique aux bibliothèques
 * ici — un composant de mise en page réutilisable pour tout futur besoin de
 * dialogue modal.
 */
export function Modal({ open, onClose, title, children, portal = false }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const dialog = (
    <AnimatePresence>
      {open && (
        <motion.div
          className={portal ? "avm-modal-backdrop avm-modal-backdrop--portal" : "avm-modal-backdrop"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            className="avm-modal-panel"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="avm-modal-panel__header">
              <h2>{title}</h2>
            </div>
            <div className="avm-modal-panel__body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return portal ? createPortal(dialog, document.body) : dialog;
}
