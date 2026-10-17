import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
  } from "react";
  import type { PointerEvent as ReactPointerEvent } from "react";
  import { useTranslation } from "react-i18next";
  import { Brush, Eraser, Trash2 } from "lucide-react";
  import { Button } from "@/components/ui/button";
  import { Slider } from "@/components/ui/slider";
  import { cn } from "@/lib/utils";
  
  export type DrawingToolHandle = {
    /** Returns the drawing as a PNG data URL, or null when the canvas is blank. */
    getDrawing: () => string | null;
  };
  
  const WIDTH = 640;
  const HEIGHT = 420;
  const PAPER = "#ffffff";
  const COLORS = [
    "#1f1f1f",
    "#f5522e",
    "#f5b83d",
    "#38a3a5",
    "#4c7cff",
    "#9b5de5",
    "#f15bb5",
    "#2e9e6b",
  ];
  
  export const DrawingTool = forwardRef<DrawingToolHandle, { className?: string }>(
    ({ className }, ref) => {
      const { t } = useTranslation();
      const canvasRef = useRef<HTMLCanvasElement | null>(null);
      const drawingRef = useRef(false);
      const lastRef = useRef<{ x: number; y: number } | null>(null);
      const dirtyRef = useRef(false);
  
      const [color, setColor] = useState(COLORS[0]);
      const [size, setSize] = useState(8);
      const [eraser, setEraser] = useState(false);
  
      useEffect(() => {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = PAPER;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      }, []);
  
      const getPos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return {
          x: ((e.clientX - rect.left) * WIDTH) / rect.width,
          y: ((e.clientY - rect.top) * HEIGHT) / rect.height,
        };
      };
  
      const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        canvasRef.current?.setPointerCapture(e.pointerId);
        drawingRef.current = true;
        lastRef.current = getPos(e);
        dirtyRef.current = true;
      };
  
      const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current) return;
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx || !lastRef.current) return;
        const pos = getPos(e);
        ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
        ctx.strokeStyle = eraser ? PAPER : color;
        ctx.lineWidth = eraser ? size * 2.5 : size;
        ctx.beginPath();
        ctx.moveTo(lastRef.current.x, lastRef.current.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        lastRef.current = pos;
      };
  
      const onUp = () => {
        drawingRef.current = false;
        lastRef.current = null;
      };
  
      const clear = () => {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = PAPER;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        dirtyRef.current = false;
      };
  
      useImperativeHandle(ref, () => ({
        getDrawing: () => {
          if (!dirtyRef.current) return null;
          return canvasRef.current?.toDataURL("image/png") ?? null;
        },
      }));
  
      return (
        <div className={cn("space-y-3", className)}>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={!eraser ? "default" : "outline"}
              onClick={() => setEraser(false)}
            >
              <Brush className="h-4 w-4" />
              {t("drawing.brush")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={eraser ? "default" : "outline"}
              onClick={() => setEraser(true)}
            >
              <Eraser className="h-4 w-4" />
              {t("drawing.eraser")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={clear}
            >
              <Trash2 className="h-4 w-4" />
              {t("drawing.clear")}
            </Button>
          </div>
  
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("drawing.brushSize")}</span>
            <Slider
              className="flex-1"
              min={2}
              max={40}
              step={1}
              value={[size]}
              onValueChange={(v) => setSize(v[0] ?? 8)}
            />
            <span
              aria-hidden
              className="rounded-full bg-foreground"
              style={{ width: Math.min(size, 24), height: Math.min(size, 24) }}
            />
          </div>
  
          <div className="flex flex-wrap items-center gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => {
                  setColor(c);
                  setEraser(false);
                }}
                className={cn(
                  "h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-background transition-transform hover:scale-110",
                  color === c && !eraser ? "ring-ring" : "ring-transparent",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                setEraser(false);
              }}
              className="h-7 w-9 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
              aria-label={t("drawing.color")}
            />
          </div>
  
          <p className="text-xs text-muted-foreground">{t("drawing.hint")}</p>
  
          <canvas
            ref={canvasRef}
            width={WIDTH}
            height={HEIGHT}
            className="w-full touch-none rounded-xl border border-border bg-white"
            style={{ cursor: "crosshair" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
          />
        </div>
      );
    },
  );
  DrawingTool.displayName = "DrawingTool";
  