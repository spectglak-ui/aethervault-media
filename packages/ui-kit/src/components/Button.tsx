import { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: ButtonVariant;
}

/**
 * Bouton animé (léger effet d'enfoncement au clic). L'animation est portée
 * une seule fois ici : tout endroit qui utilise `Button` en bénéficie
 * automatiquement, sans dupliquer de logique `framer-motion`.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", className, ...props }, ref) => (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.12 }}
      className={["avm-button", `avm-button--${variant}`, className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  )
);

Button.displayName = "Button";
