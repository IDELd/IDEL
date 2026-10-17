import { cn } from "@/lib/utils";

/**
 * User avatar: uploaded image when present, otherwise a letter fallback.
 */
export function UserAvatar({
  user,
  size = "md",
  className,
}: {
  user?: { avatarUrl: string | null; username: string } | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const sizes = {
    sm: "h-8 w-8 text-sm",
    md: "h-11 w-11 text-lg",
    lg: "h-16 w-16 text-2xl",
    xl: "h-24 w-24 text-4xl",
  };
  const box = cn("shrink-0 overflow-hidden rounded-full", sizes[size]);

  if (!user) {
    return <div className={cn(box, "bg-secondary", className)} />;
  }

  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.username}
        className={cn(box, "object-cover ring-1 ring-border", className)}
      />
    );
  }

  return (
    <div
      className={cn(
        box,
        "flex items-center justify-center bg-foreground font-bold uppercase text-background",
        className,
      )}
    >
      {user.username.charAt(0)}
    </div>
  );
}
