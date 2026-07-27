'use client';

import React from 'react';

// Variants and their exact values come from 02-design-system.md.
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
// 'lg' is the first-run CTA scale (15px / 14px 30px / radius 12).
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  fullWidth?: boolean;
  title?: string;
}

const variantStyles: Record<ButtonVariant, string> = {
  // 02: the primary button is the gradient, not a flat fill.
  primary:
    'bg-gradient-to-br from-[#8094F5] to-[#5B60FF] text-white font-bold shadow-stiko-primary border-0 hover:brightness-[1.04]',
  secondary:
    'border-[1.5px] border-stiko-border-strong bg-white text-stiko-ink font-bold hover:bg-stiko-app',
  ghost: 'bg-transparent text-stiko-muted font-bold hover:text-stiko-ink',
  danger:
    'border-[1.5px] bg-white font-bold hover:bg-[#FFF5F5] border-[#FFC9C9] text-[#B23A52]',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-[6px] text-[12px] rounded-[9px]',
  md: 'px-[18px] py-[10px] text-[13px] rounded-[11px]',
  lg: 'px-[30px] py-[14px] text-[15px] rounded-[12px]',
};

// Secondary is a touch smaller than primary at the same size, per 02.
const secondarySize: Record<ButtonSize, string> = {
  sm: 'px-3 py-[6px] text-[11.5px] rounded-[9px]',
  md: 'px-[16px] py-[9px] text-[12.5px] rounded-[10px]',
  lg: 'px-[28px] py-[13px] text-[14px] rounded-[12px]',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  onClick,
  children,
  className = '',
  type = 'button',
  disabled = false,
  fullWidth = false,
  title,
}: ButtonProps) {
  const sizing =
    variant === 'secondary' || variant === 'danger'
      ? secondarySize[size]
      : sizeStyles[size];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      // The disabled treatment is its own thing, not an opacity fade: 02
      // specifies a flat #EFEFF4 fill with #A2A7B8 text and no shadow.
      className={`inline-flex items-center justify-center whitespace-nowrap outline-none transition duration-150 focus-visible:shadow-stiko-focus ${
        disabled
          ? 'cursor-not-allowed border-0 bg-stiko-idle font-bold text-stiko-faint shadow-none'
          : variantStyles[variant]
      } ${sizing} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {children}
    </button>
  );
}
