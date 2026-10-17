import { Bot } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Small "bot" badge shown next to @verifybot instead of a verified checkmark. */
export function BotBadge({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex shrink-0 cursor-help items-center gap-0.5 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-bold uppercase text-background align-middle",
            className,
          )}
        >
          <Bot className="h-3 w-3" />
          bot
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">Автоматический аккаунт</TooltipContent>
    </Tooltip>
  );
}
