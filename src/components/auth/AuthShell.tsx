import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-background via-background to-primary-soft/70 px-4 py-10 dark:to-primary-soft/20">
      <span className="bg-brand-gradient bg-clip-text text-4xl font-extrabold tracking-tight text-transparent">
        {t("common.appName")}
      </span>
      <div className="mt-5 w-full max-w-sm animate-fade-up rounded-2xl border border-border bg-card p-6 shadow-soft">
        {title && <h1 className="text-lg font-bold">{title}</h1>}
        {subtitle && (
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        )}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
