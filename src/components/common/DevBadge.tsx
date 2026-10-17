import { useTranslation } from "react-i18next";
import { Terminal } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Small console/terminal icon shown on the developer's profile. */
export function DevBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex cursor-help align-middle", className)}>
          <Terminal className="h-4 w-4 shrink-0 text-foreground" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{t("badge.dev")}</TooltipContent>
    </Tooltip>
  );
}
