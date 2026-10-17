import { useEffect, useState } from "react";
import * as api from "@/lib/api";

/**
 * Живая проверка ника по таблице forbidden_words (дебаунс 350 мс).
 * Возвращает true, если сервер считает ник запрещённым.
 */
export function useNicknameCheck(username: string) {
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    const candidate = username.trim().toLowerCase();
    if (!candidate) {
      setForbidden(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .checkNickname(candidate)
        .then((res) => {
          if (!cancelled) setForbidden(res.allowed === false);
        })
        .catch(() => {
          if (!cancelled) setForbidden(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username]);

  return forbidden;
}
