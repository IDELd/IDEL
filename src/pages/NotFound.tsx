import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();
  const { t } = useTranslation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-gradient-to-b from-background via-background to-primary-soft/70 px-4 text-center dark:to-primary-soft/20">
      <p className="text-7xl font-extrabold tracking-tight text-primary">404</p>
      <p className="text-muted-foreground">{t("notFound.title")}</p>
      <Button asChild>
        <Link to="/">{t("notFound.actions.backHome")}</Link>
      </Button>
    </div>
  );
};

export default NotFound;
