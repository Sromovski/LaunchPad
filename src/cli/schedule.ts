/**
 *   npm run schedule:install    → per channel: daily make-video jobs + one posting job (times in src/channels.ts)
 *   npm run schedule:uninstall
 *   npm run schedule:status
 * Thomas's choices (2026-09-27): wake the PC to run, only while he's logged on
 * (no stored Windows password), queue cap 6 per channel (enforced by the run's preflight).
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { CHANNELS, type Channel } from '../channels.js';
import { PROJECT_ROOT } from '../db/index.js';
import { main } from './_lib.js';

/** Earlier single-time task name, removed on install. */
const LEGACY_PUBLISH_TASKS = ['publish-1600'];
const FOLDER = '\\Launchpad\\';
// Blast of Facts keeps its original task names; other channels get their key as a prefix.
const prefix = (c: Channel) => (c.key === 'blast' ? '' : `${c.key}-`);
const taskName = (c: Channel, t: string) => `${prefix(c)}make-video-${t.replace(':', '')}`;
const publishTask = (c: Channel) => `${prefix(c)}publish`;
const REVIEW_TASK = 'review-site';
const channels = Object.values(CHANNELS);
const allTasks = () => [...channels.flatMap((c) => [...c.makeTimes.map((t) => taskName(c, t)), publishTask(c)]), ...LEGACY_PUBLISH_TASKS, REVIEW_TASK];

function ps(script: string): string {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-4).join('\n'));
  return r.stdout.trim();
}

const command = process.argv[2];

await main(() => {
  if (process.platform !== 'win32') throw new Error('schedule.ts manages Windows Task Scheduler; use cron/launchd elsewhere');
  const log = resolve(PROJECT_ROOT, 'runs', '_scheduled', 'task.log');

  switch (command) {
    case 'install': {
      for (const c of channels) {
        for (const t of c.makeTimes) {
          // cmd /c so npm's .cmd shim resolves from the user's PATH; output appended to a log.
          const arg = `/c cd /d "${PROJECT_ROOT}" && npm run scheduled -- --trigger scheduled --channel ${c.key} >> "${log}" 2>&1`;
          ps(
            [
              `$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '${arg.replace(/'/g, "''")}' -WorkingDirectory '${PROJECT_ROOT}'`,
              `$t = New-ScheduledTaskTrigger -Daily -At '${t}'`,
              // WakeToRun: wake from sleep. StartWhenAvailable: run late if the PC was off. IgnoreNew: never overlap.
              `$s = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 90) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`,
              `$p = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Limited`,
              `Register-ScheduledTask -TaskPath '${FOLDER}' -TaskName '${taskName(c, t)}' -Action $a -Trigger $t -Settings $s -Principal $p -Description 'Launchpad: one headless /make-video run for ${c.title} (fills the review queue only)' -Force | Out-Null`,
            ].join('; '),
          );
        }
        const plog = resolve(PROJECT_ROOT, 'runs', '_publish', 'task.log');
        const arg = `/c cd /d "${PROJECT_ROOT}" && npm run publish -- --trigger scheduled --channel ${c.key} >> "${plog}" 2>&1`;
        ps(
          [
            `$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '${arg.replace(/'/g, "''")}' -WorkingDirectory '${PROJECT_ROOT}'`,
            `$t = @(${c.postTimes.map((t) => `(New-ScheduledTaskTrigger -Daily -At '${t}')`).join(', ')})`,
            `$s = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`,
            `$p = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Limited`,
            `Register-ScheduledTask -TaskPath '${FOLDER}' -TaskName '${publishTask(c)}' -Action $a -Trigger $t -Settings $s -Principal $p -Description 'Launchpad: post one approved video to ${c.title} (each run)' -Force | Out-Null`,
            ...LEGACY_PUBLISH_TASKS.map((n) => `Unregister-ScheduledTask -TaskPath '${FOLDER}' -TaskName '${n}' -Confirm:$false -ErrorAction SilentlyContinue`),
          ].join('; '),
        );
      }
      {
        // Review site at logon, hidden (wscript + .vbs avoids a console window), running until logoff.
        const vbs = resolve(PROJECT_ROOT, 'scripts', 'start-review-hidden.vbs');
        ps(
          [
            `$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '"${vbs}"' -WorkingDirectory '${PROJECT_ROOT}'`,
            `$t = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\\$env:USERNAME"`,
            `$s = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`,
            `$p = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Limited`,
            `Register-ScheduledTask -TaskPath '${FOLDER}' -TaskName '${REVIEW_TASK}' -Action $a -Trigger $t -Settings $s -Principal $p -Description 'Launchpad: review site at http://launchpad.localhost' -Force | Out-Null`,
          ].join('; '),
        );
      }
      return { installed: allTasks().filter((n) => !LEGACY_PUBLISH_TASKS.includes(n)).map((n) => `${FOLDER}${n}`), log };
    }
    case 'uninstall': {
      for (const name of allTasks()) ps(`Unregister-ScheduledTask -TaskPath '${FOLDER}' -TaskName '${name}' -Confirm:$false -ErrorAction SilentlyContinue`);
      return { removed: allTasks().map((n) => `${FOLDER}${n}`) };
    }
    case 'status': {
      const out = ps(
        `Get-ScheduledTask -TaskPath '${FOLDER}' -ErrorAction SilentlyContinue | ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; [pscustomobject]@{ name = $_.TaskName; state = [string]$_.State; next = [string]$i.NextRunTime; last = [string]$i.LastRunTime; last_result = $i.LastTaskResult } } | ConvertTo-Json -Compress`,
      );
      return { tasks: out ? [JSON.parse(out)].flat() : [] };
    }
    default:
      throw new Error('usage: schedule.ts install|uninstall|status');
  }
});
