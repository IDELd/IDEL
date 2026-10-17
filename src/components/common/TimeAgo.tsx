import { useTimeAgo } from "@/lib/time";

export function TimeAgo({
  iso,
  className,
}: {
  iso: string;
  className?: string;
}) {
  const label = useTimeAgo(iso);
  return (
    <time dateTime={iso} className={className}>
      {label}
    </time>
  );
}
