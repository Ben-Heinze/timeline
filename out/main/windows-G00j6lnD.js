"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const child_process = require("child_process");
const util = require("util");
const execFileAsync = util.promisify(child_process.execFile);
async function detect() {
  try {
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-Volume | Select-Object DriveLetter,FileSystemLabel,UniqueId | ConvertTo-Json"
    ]);
    const parsed = JSON.parse(stdout);
    const volumes = Array.isArray(parsed) ? parsed : [parsed];
    return volumes.filter((v) => !!v.DriveLetter && !!v.UniqueId).map((v) => ({
      serial: v.UniqueId,
      mountPath: `${v.DriveLetter}:\\`,
      osLabel: v.FileSystemLabel || `${v.DriveLetter}:`
    }));
  } catch {
    return [];
  }
}
exports.detect = detect;
