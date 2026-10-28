"""Transcreve áudios em lote com faster-whisper.

Protocolo:
  stdin : uma linha JSON por áudio -> {"id": "...", "path": "C:\\...\\audio.ogg"}
  stdout: uma linha JSON por resultado -> {"id", "text", "language", "duration"} ou {"id", "error"}
  stderr: progresso e logs
O modelo é carregado uma única vez por execução.
"""
import argparse
import json
import sys
import time


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="small")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--beam-size", type=int, default=1)
    parser.add_argument("--language", default="pt")
    parser.add_argument("--initial-prompt", default="")
    parser.add_argument("--threads", type=int, default=0)
    args = parser.parse_args()

    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

    requests = [json.loads(line) for line in sys.stdin if line.strip()]
    if not requests:
        return 0

    from faster_whisper import WhisperModel

    print(f"carregando modelo {args.model} ({args.compute_type})...", file=sys.stderr, flush=True)
    started = time.time()
    model = WhisperModel(args.model, device="cpu", compute_type=args.compute_type, cpu_threads=args.threads)
    print(f"modelo pronto em {time.time() - started:.1f}s", file=sys.stderr, flush=True)

    for i, req in enumerate(requests, 1):
        try:
            t0 = time.time()
            segments, info = model.transcribe(
                req["path"],
                language=args.language or None,
                beam_size=args.beam_size,
                vad_filter=True,
                condition_on_previous_text=False,
                initial_prompt=args.initial_prompt or None,
            )
            text = " ".join(s.text.strip() for s in segments).strip()
            out = {
                "id": req["id"],
                "text": text,
                "language": info.language,
                "duration": round(info.duration, 2),
            }
            print(
                f"[{i}/{len(requests)}] {info.duration:.0f}s de áudio em {time.time() - t0:.1f}s",
                file=sys.stderr,
                flush=True,
            )
        except Exception as exc:  # noqa: BLE001 - um áudio ruim não derruba o lote
            out = {"id": req["id"], "error": str(exc)}
        print(json.dumps(out, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
