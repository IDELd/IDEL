import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/media";
import { cn } from "@/lib/utils";

export function AudioPlayer({
  src,
  duration,
  className,
}: {
  src: string;
  duration: number;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-secondary/60 px-2 py-1.5 pr-3",
        className,
      )}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <Button
        size="icon"
        className="h-8 w-8 rounded-full"
        aria-label={playing ? "Pause" : "Play"}
        onClick={toggle}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 pl-0.5" />}
      </Button>
      <span className="text-xs tabular-nums text-muted-foreground">
        {formatDuration(duration)}
      </span>
    </div>
  );
}
