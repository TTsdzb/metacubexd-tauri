// Runs the Tauri CLI with the environment a Linux desktop needs.
//
// On NVIDIA's proprietary driver under Wayland, a WebKitGTK window dies on
// startup unless explicit sync is disabled. Setting it here rather than asking
// every contributor to export it means `pnpm dev:tauri` works on a fresh
// checkout. The variable is read only by NVIDIA's driver, so it is inert on
// AMD, Intel, and every non-Linux platform.
//
// An already-set value always wins, so exporting your own (or `=0`) overrides
// this without editing the file.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// Resolve the CLI's JS entry and run it under this Node rather than spawning
// the `tauri` shim from PATH: Windows will not resolve a .cmd shim without a
// shell, and going through a shell would mangle argument quoting.
const cli = require.resolve('@tauri-apps/cli/tauri.js')

const env = { ...process.env }
if (process.platform === 'linux') {
  env.__NV_DISABLE_EXPLICIT_SYNC ??= '1'
}

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
})

child.on('exit', (code, signal) => {
  // Re-raise a signal death as a signal death so Ctrl-C behaves normally.
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
