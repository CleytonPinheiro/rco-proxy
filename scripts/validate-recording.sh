#!/bin/bash
SRC_DIR="$(dirname "$0")/../src"
errors=0

if ! grep -rq "useVideoPlayer" "$SRC_DIR/components/"; then
  echo "ERROR: No component imports useVideoPlayer from @/lib/video."
  errors=$((errors + 1))
fi

if ! grep -Fq 'window.startRecording?.()' "$SRC_DIR/lib/video/hooks.ts" 2>/dev/null; then
  echo "ERROR: src/lib/video/hooks.ts is missing window.startRecording?.() call."
  errors=$((errors + 1))
fi

if ! grep -Fq 'window.stopRecording?.()' "$SRC_DIR/lib/video/hooks.ts" 2>/dev/null; then
  echo "ERROR: src/lib/video/hooks.ts is missing window.stopRecording?.() call."
  errors=$((errors + 1))
fi

if [ $errors -gt 0 ]; then
  echo "Found $errors error(s)."
  exit 1
fi

echo "Recording lifecycle validation passed."
exit 0
