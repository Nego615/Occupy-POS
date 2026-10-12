import type { ButtonHTMLAttributes } from 'react';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** `primary` = brand fill, ink by default (Charge, Save, Confirm). `secondary` = paper + hairline. `accent` = marigold, for the one thing to do first. */
  variant?: ButtonVariant;
  /** `lg` is the countertop action size used for Charge. */
  size?: ButtonSize;
  /** Stretch to the full width of the container. */
  block?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    block ? 'btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return <button type={type} className={classes} {...rest} />;
}
