"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const child_process = require("child_process");
const util = require("util");
const execFileAsync = util.promisify(child_process.execFile);
async function detect() {
  try {
    const { stdout } = await execFileAsync("lsblk", ["-o", "UUID,LABEL,MOUNTPOINT", "-J"]);
    const { blockdevices } = JSON.parse(stdout);
    const out = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.uuid && n.mountpoint && n.mountpoint.startsWith("/")) {
          out.push({ serial: n.uuid, mountPath: n.mountpoint, osLabel: n.label ?? n.mountpoint });
        }
        if (n.children) walk(n.children);
      }
    };
    walk(blockdevices);
    return out;
  } catch {
    return [];
  }
}
exports.detect = detect;
