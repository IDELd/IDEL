import { useTranslation } from "react-i18next";
import { BadgeCheck } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Blue verification checkmark shown next to verified usernames on profiles,
 * posts, comments and search results.
 */
export function VerificationBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex cursor-help align-middle", className)}>
          <BadgeCheck className="h-4 w-4 shrink-0 fill-blue-500 text-white" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{t("badge.verified")}</TooltipContent>
    </Tooltip>
  );
}
