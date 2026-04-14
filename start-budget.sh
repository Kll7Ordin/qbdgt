#!/bin/bash
cd PROJECT_DIR
# Kill any leftover dev server on 5173
fuser -k 5173/tcp 2>/dev/null
sleep 0.5
npm run tauri dev
