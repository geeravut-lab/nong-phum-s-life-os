import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

// TEMPORARY — capability probe for Phase 1 task E (voice input).
// Its only job is to answer, on a real phone inside LINE's in-app browser,
// whether getUserMedia + MediaRecorder work there and which audio container
// the browser produces. Delete this file once task E ships.

export const Route = createFileRoute("/mic-test")({
  ssr: false,
  head: () => ({ meta: [{ title: "Mic test" }] }),
  component: MicTestPage,
});

const PROBE_TYPES = ["audio/webm", "audio/mp4", "audio/aac"] as const;

type Phase =
  | { step: "idle" }
  | { step: "asking" }
  | { step: "denied"; name: string; message: string }
  | { step: "recording"; secondsLeft: number }
  | { step: "done"; mimeType: string; bytes: number; url: string }
  | { step: "record-failed"; name: string; message: string };

function MicTestPage() {
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [support, setSupport] = useState<Record<string, boolean | "n/a">>({});
  const [userAgent, setUserAgent] = useState("");
  const [hasRecorder, setHasRecorder] = useState<boolean | null>(null);
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    setUserAgent(navigator.userAgent);
    const recorderExists = typeof MediaRecorder !== "undefined";
    setHasRecorder(recorderExists);
    const result: Record<string, boolean | "n/a"> = {};
    for (const type of PROBE_TYPES) {
      result[type] = recorderExists ? MediaRecorder.isTypeSupported(type) : "n/a";
    }
    setSupport(result);
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  const run = async () => {
    setPhase({ step: "asking" });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const e = err as { name?: string; message?: string };
      setPhase({ step: "denied", name: e?.name ?? "UnknownError", message: e?.message ?? String(err) });
      return;
    }

    try {
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType });
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = URL.createObjectURL(blob);
        setPhase({
          step: "done",
          mimeType: recorder.mimeType || "(empty — browser did not report one)",
          bytes: blob.size,
          url: objectUrl.current,
        });
      };
      recorder.start();
      let left = 3;
      setPhase({ step: "recording", secondsLeft: left });
      const tick = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(tick);
          recorder.stop();
        } else {
          setPhase({ step: "recording", secondsLeft: left });
        }
      }, 1000);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      const e = err as { name?: string; message?: string };
      setPhase({ step: "record-failed", name: e?.name ?? "UnknownError", message: e?.message ?? String(err) });
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 bg-background p-5 text-foreground">
      <h1 className="text-2xl font-bold">ทดสอบไมโครโฟน</h1>

      <button
        type="button"
        onClick={run}
        disabled={phase.step === "asking" || phase.step === "recording"}
        className="rounded-2xl bg-primary px-6 py-6 text-2xl font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
      >
        {phase.step === "asking"
          ? "กำลังขอสิทธิ์..."
          : phase.step === "recording"
            ? `กำลังอัด... ${phase.secondsLeft}`
            : "ทดสอบไมโครโฟน"}
      </button>

      <section className="rounded-2xl border border-border bg-card p-4 text-lg">
        {phase.step === "idle" && <p className="text-muted-foreground">กดปุ่มด้านบนเพื่อเริ่ม</p>}
        {phase.step === "asking" && <p>รอเบราว์เซอร์ถามสิทธิ์ไมค์…</p>}
        {phase.step === "denied" && (
          <div className="space-y-2">
            <p className="text-3xl font-bold text-destructive">❌ getUserMedia ล้มเหลว</p>
            <p className="break-all font-mono text-base">
              <b>name:</b> {phase.name}
            </p>
            <p className="break-all font-mono text-base">
              <b>message:</b> {phase.message}
            </p>
          </div>
        )}
        {phase.step === "recording" && (
          <p className="text-3xl font-bold text-primary">✅ ได้ไมค์แล้ว กำลังอัด {phase.secondsLeft} วิ</p>
        )}
        {phase.step === "record-failed" && (
          <div className="space-y-2">
            <p className="text-2xl font-bold text-primary">✅ getUserMedia ผ่าน</p>
            <p className="text-3xl font-bold text-destructive">❌ แต่ MediaRecorder ล้มเหลว</p>
            <p className="break-all font-mono text-base">
              <b>name:</b> {phase.name}
            </p>
            <p className="break-all font-mono text-base">
              <b>message:</b> {phase.message}
            </p>
          </div>
        )}
        {phase.step === "done" && (
          <div className="space-y-3">
            <p className="text-3xl font-bold text-primary">✅ อัดสำเร็จ</p>
            <p className="break-all font-mono text-base">
              <b>mimeType จริง:</b> {phase.mimeType}
            </p>
            <p className="font-mono text-base">
              <b>ขนาด:</b> {phase.bytes.toLocaleString()} bytes
            </p>
            <audio controls src={phase.url} className="w-full" />
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-2 text-lg font-semibold">MediaRecorder.isTypeSupported()</h2>
        {hasRecorder === false && (
          <p className="mb-2 text-lg font-bold text-destructive">❌ ไม่มี MediaRecorder ในเบราว์เซอร์นี้</p>
        )}
        <ul className="space-y-1 font-mono text-base">
          {PROBE_TYPES.map((type) => (
            <li key={type}>
              {support[type] === true ? "✅" : support[type] === false ? "❌" : "—"} {type}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-2 text-lg font-semibold">navigator.userAgent</h2>
        <p className="break-all font-mono text-sm">{userAgent || "…"}</p>
      </section>
    </main>
  );
}
