/** Usernames: letters (latin or cyrillic), digits, underscore. 3-20 chars. */
export const USERNAME_RE = /^[a-zа-яё0-9_]{3,20}$/i;

/**
 * Сообщение, которым сервер отказывает в запрещённом нике.
 * Нужно, чтобы форма показала локализованный текст вместо серверной строки.
 */
export const FORBIDDEN_USERNAME_MESSAGE = "Данный юзернейм запрещён";
