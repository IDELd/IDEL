import type { CSSProperties } from "react";
import type { User } from "./types";

/** #rrggbb → {r,g,b}; null для мусора. */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/**
 * Цвет текста под подложку: считаем яркость и берём чёрный или белый,
 * чтобы сообщение оставалось читаемым на любом цвете из палитры.
 */
export function contrastTextColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#ffffff";
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.62 ? "#1a1a1a" : "#ffffff";
}

/** Цвет подложки с прозрачностью — для мягкой заливки карточек. */
export function tintedBackground(hex: string, alpha: number): string | undefined {
  const rgb = hexToRgb(hex);
  if (!rgb) return undefined;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/**
 * Подложка сообщения/комментария: полный цвет подписки + контрастный текст.
 * Возвращает undefined для обычных пользователей — у них стиль из классов.
 */
export function bubbleStyle(
  user?: Pick<User, "messageColor" | "premium"> | null,
): CSSProperties | undefined {
  if (!user?.premium || !user.messageColor) return undefined;
  return {
    backgroundColor: user.messageColor,
    color: contrastTextColor(user.messageColor),
  };
}

/** Мягкая заливка карточки поста (цвет подписки в 15% непрозрачности). */
export function softTintStyle(
  user?: Pick<User, "messageColor" | "premium"> | null,
): CSSProperties | undefined {
  if (!user?.premium || !user.messageColor) return undefined;
  const background = tintedBackground(user.messageColor, 0.15);
  return background ? { backgroundColor: background } : undefined;
}
