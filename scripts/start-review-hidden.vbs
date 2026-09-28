' Starts the Launchpad review site (http://launchpad.localhost) with no console window.
' Run at Windows logon by the Task Scheduler job "\Launchpad\review-site" (npm run schedule:install).
Set shell = CreateObject("WScript.Shell")
root = CreateObject("Scripting.FileSystemObject").GetParentFolderName(CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root
shell.Run "cmd /c set BROWSER=none&& node node_modules\vite\bin\vite.js --config review-site\vite.config.ts > runs\_review-site.log 2>&1", 0, False
