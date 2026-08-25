import { forwardRef, type ButtonHTMLAttributes } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Libellé accessible obligatoire : ce bouton n'affiche qu'une icône. */
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, className, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={["avm-icon-button", className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </button>
  )
);

IconButton.displayName = "IconButton";
