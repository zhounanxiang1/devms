Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)
shell.CurrentDirectory = projectDir
nodeExe = "C:\Users\zhoun\Documents\Codex\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node"
q = Chr(34)
cmd = "cmd.exe /d /c " & q & q & nodeExe & q & " apps\api\dist\main.js >> api-prod.log 2>> api-prod.err.log" & q
shell.Run cmd, 0, False
