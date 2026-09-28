/**
 *   npm run schedule:install    → two daily Task Scheduler jobs (07:00, 15:00) running `npm run scheduled`
 *   npm run schedule:uninstall
 *   npm run schedule:status
 * Thomas's choices (2026-09-27): wake the PC to run, only while he's logged on
 * (no stored Windows password), queue cap 6 (enforced by the run's preflight).
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from '../db/index.js';
import { main } from './_lib.js';

export const TIMES = ['07:00', '15:00'];
/** Phase 4: one post a day (Thomas, 2026-09-27). */
/** Phase 4: two posts a day, matching production (Thomas, 2026-09-28). One task, two daily triggers. */
export const PUBLISH_TIMES = ['08:00', '16:00'];
/** Earlier single-time task name, removed on install. */
const LEGACY_PUBLISH_TASKS = ['publish-1600'];
const FOLDER = '\\Launchpad\\';
const taskName = (t: string) => `make-video-${t.replace(':', '')}`;
const PUBLISH_TASK = 'publish';
const REVIEW_TASK = 'review-site';

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
      for (const t of TIMES) {
        // cmd /c so npm's .cmd shim resolves from the user's PATH; output appended to a log.
        const arg = `/c cd /d "${PROJECT_ROOT}" && npm run scheduled -- --trigger scheduled >> "${log}" 2>&1`;
        ps(
          [
            `$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '${arg.replace(/'/g, "''")}' -WorkingDirectory '${PROJECT_ROOT}'`,
            `$t = New-ScheduledTaskTrigger -Daily -At '${t}'`,
            // WakeToRun: wake from sleep. StartWhenAvailable: run late if the PC was off. IgnoreNew: never overlap.
            `$s = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 90) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`,
            `$p = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Limited`,
            `Register-ScheduledTask -TaskPath '${FOLDER}' -TaskName '${taskName(t)}' -Action $a -Trigger $t -Settings $s -Principal $p -Description 'Launchpad: one headless /make-video run (fills the review queue only)' -Force | Out-Null`,
          ].join('; '),
        );
      }
      {
        const plog = resolve(PROJECT_ROOT, 'runs', '_publish', 'task.log');
        const arg = `/c cd /d "${PROJECT_ROOT}" && npm run publish -- --trigger scheduled >> "${plog}" 2>&1`;
        ps(
          [
            `$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '${arg.replace(/'/g, "''")}' -WorkingDirectory '${PROJECT_ROOT}'`,
            `$t = @(${PUBLISH_TIMES.map((t) => `(New-ScheduledTaskTrigger -Daily -At '${t}')`).join(', ')})`,
            `$s = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`,
            `$p = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Limited`,
            `Register-ScheduledTask -TaskPath '${FOLDER}' -TaskName '${PUBLISH_TASK}' -Action $a -Trigger $t -Settings $s -Principal $p -Description 'Launchpad: post one approved video to Blast of Facts (each run)' -Force | Out-Null`,
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
      return { installed: [...TIMES.map((t) => `${FOLDER}${taskName(t)}`), `${FOLDER}${PUBLISH_TASK}`, `${FOLDER}${REVIEW_TASK}`], log };
    }
    case 'uninstall': {
      for (const name of [...TIMES.map(taskName), PUBLISH_TASK, ...LEGACY_PUBLISH_TASKS, REVIEW_TASK]) ps(`Unregister-ScheduledTask -TaskPath '${FOLDER}' -TaskName '${name}' -Confirm:$false -ErrorAction SilentlyContinue`);
      return { removed: [...TIMES.map(taskName), PUBLISH_TASK, ...LEGACY_PUBLISH_TASKS, REVIEW_TASK].map((n) => `${FOLDER}${n}`) };
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
