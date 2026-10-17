import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { blobToDataUrl, formatDuration } from "@/lib/media";
import { cn } from "@/lib/utils";

/** Минимальные типы Web Speech API: в lib.dom его нет. */
type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function createRecognition(lang: string): SpeechRecognitionLike | null {
  const scope = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = scope.SpeechRecognition || scope.webkitSpeechRecognition;
  if (!Ctor) return null;
  try {
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onerror = null;
    recognition.onend = null;
    return recognition;
  } catch {
    return null;
  }
}

/** Небольшая пауза, чтобы после остановки пришёл финальный результат распознавания. */
const FINAL_RESULT_WAIT_MS = 350;

export function VoiceRecorder({
  onRecorded,
  compact = false,
  transcriptEnabled = false,
}: {
  onRecorded: (dataUrl: string, durationSeconds: number, transcript: string | null) => void;
  compact?: boolean;
  /** Распознавание речи при записи — функция ИДЕЛЬ ПРЕМИУМ. */
  transcriptEnabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      recognitionRef.current?.abort();
    };
  }, []);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error(t("common.micError"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      transcriptRef.current = "";

      // Распознавание речи идёт параллельно записи: браузер отдаёт текст по мере
      // произнесения. Если API нет — расшифровки просто не будет, без заглушек.
      if (transcriptEnabled) {
        const recognition = createRecognition(i18n.resolvedLanguage?.startsWith("en") ? "en-US" : "ru-RU");
        if (recognition) {
          recognition.onresult = (event) => {
            let finalText = "";
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
              const result = event.results[i];
              if (result.isFinal) finalText += `${result[0].transcript} `;
            }
            if (finalText) transcriptRef.current = `${transcriptRef.current}${finalText}`.trim();
          };
          recognitionRef.current = recognition;
          try {
            recognition.start();
          } catch {
            recognitionRef.current = null;
          }
        }
      }

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const duration = (Date.now() - startRef.current) / 1000;
        setSaving(true);

        const recognition = recognitionRef.current;
        if (recognition) {
          try {
            recognition.stop();
          } catch {
            // уже остановлено — не страшно
          }
          // Даём распознаванию отдать финальный результат.
          await new Promise((resolve) => window.setTimeout(resolve, FINAL_RESULT_WAIT_MS));
          recognitionRef.current = null;
        }
        const transcript = transcriptRef.current.trim() || null;

        const dataUrl = await blobToDataUrl(blob);
        setSaving(false);
        onRecorded(dataUrl, duration, transcript);
      };
      recorderRef.current = recorder;
      startRef.current = Date.now();
      setSeconds(0);
      recorder.start();
      setRecording(true);
      timerRef.current = window.setInterval(
        () => setSeconds((s) => s + 1),
        1000,
      );
    } catch {
      toast.error(t("common.micError"));
    }
  };

  const stop = () => {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
    if (timerRef.current) window.clearInterval(timerRef.current);
    setRecording(false);
  };

  if (recording) {
    return (
      <Button
        size={compact ? "icon" : "sm"}
        variant="destructive"
        className={cn("animate-pulse", compact && "h-9 w-9")}
        onClick={stop}
        title={transcriptEnabled ? t("premium.recordingWithTranscript") : t("post.recordVoice")}
      >
        <Square className="h-4 w-4" />
        {!compact && formatDuration(seconds)}
      </Button>
    );
  }

  return (
    <Button
      size={compact ? "icon" : "sm"}
      variant="ghost"
      className={compact && "h-9 w-9"}
      onClick={start}
      disabled={saving}
      title={transcriptEnabled ? t("premium.recordWithTranscript") : t("post.recordVoice")}
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
      {!compact && t("post.recordVoice")}
    </Button>
  );
}
