Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)
shell.CurrentDirectory = projectDir
nodeExe = "C:\Users\zhoun\Documents\Codex\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node"
q = Chr(34)
cmd = "cmd.exe /d /c " & q & q & nodeExe & q & " node_modules\vite\bin\vite.js apps\web --host 0.0.0.0 --port 5174 --strictPort >> web-dev.log 2>> web-dev.err.log" & q
shell.Run cmd, 0, False
