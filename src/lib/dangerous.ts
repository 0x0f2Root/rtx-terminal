/**
 * Recognises commands that can destroy data or take the machine down, so the app asks before
 * sending them. This is a safety net for one-click execution, not a sandbox: anything typed by
 * hand goes straight to the shell.
 */
const RULES: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\brm\s+(-[a-zA-Z]*[rRf][a-zA-Z]*\s+)+/,
    reason: 'removes files recursively or without prompting',
  },
  {
    pattern: /\b(mkfs(\.\w+)?|wipefs|fdisk|parted|sgdisk)\b/,
    reason: 'changes disks or filesystems',
  },
  {
    pattern: /\bdd\b[^|;&]*\bof=/,
    reason: 'writes raw data to a file or device',
  },
  {
    pattern: />\s*\/dev\/(sd|nvme|hd|vd|mmcblk)/,
    reason: 'writes directly to a block device',
  },
  {
    pattern:
      /\b(shutdown|reboot|poweroff|halt)\b|\bsystemctl\s+(poweroff|reboot|halt|kexec)\b/,
    reason: 'shuts down or restarts the machine',
  },
  {
    pattern:
      /\bchmod\s+(-[a-zA-Z]*R|--recursive)|\bchown\s+(-[a-zA-Z]*R|--recursive)/,
    reason: 'changes permissions recursively',
  },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: 'is a fork bomb' },
  {
    pattern:
      /\bgit\s+(push\s+[^;&|]*(--force\b|-f\b)|reset\s+--hard|clean\s+-[a-zA-Z]*f)/,
    reason: 'discards Git history or local changes',
  },
  {
    pattern: /\b(kill|pkill|killall)\s+(-9|-KILL|-SIGKILL)\b/,
    reason: 'force-kills processes',
  },
  {
    pattern: /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i,
    reason: 'deletes database data',
  },
  {
    pattern:
      /\bdocker\s+(system\s+prune|volume\s+(rm|prune))|\bkubectl\s+delete\b/,
    reason: 'deletes containers, volumes or cluster resources',
  },
  {
    pattern:
      /\bcurl\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b|\bwget\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/,
    reason: 'runs a script downloaded from the network',
  },
];

export function destructiveReason(command: string): string | null {
  for (const rule of RULES) {
    if (rule.pattern.test(command)) return rule.reason;
  }
  return /(^|[\s;&|])sudo\s/.test(command)
    ? 'runs with administrator privileges'
    : null;
}
