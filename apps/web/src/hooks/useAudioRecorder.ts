import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "recording" | "paused" | "preview";

export function useAudioRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileRef = useRef<File | null>(null);
  const discardOnStopRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    discardOnStopRef.current = false;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      stopTimer();

      if (discardOnStopRef.current) {
        discardOnStopRef.current = false;
        chunksRef.current = [];
        setSeconds(0);
        setState("idle");
        return;
      }

      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      fileRef.current = new File([blob], `audio-${Date.now()}.webm`, { type: "audio/webm" });
      setPreviewUrl(URL.createObjectURL(blob));
      setState("preview");
    };

    recorder.start();
    recorderRef.current = recorder;
    setSeconds(0);
    setState("recording");
    intervalRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }

  function pause() {
    recorderRef.current?.pause();
    stopTimer();
    setState("paused");
  }

  function resume() {
    recorderRef.current?.resume();
    intervalRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    setState("recording");
  }

  // Ends the recording and moves to the preview state — does NOT send anything.
  function finish() {
    recorderRef.current?.stop();
  }

  // Stops (if still recording) and throws the take away entirely, without ever previewing it.
  function cancel() {
    if (state === "recording" || state === "paused") {
      discardOnStopRef.current = true;
      recorderRef.current?.stop();
    } else {
      discard();
    }
  }

  // Discards a take that's already in the preview state.
  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    fileRef.current = null;
    setSeconds(0);
    setState("idle");
  }

  function getFile(): File | null {
    return fileRef.current;
  }

  return { state, previewUrl, seconds, start, pause, resume, finish, cancel, discard, getFile };
}
