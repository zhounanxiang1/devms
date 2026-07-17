Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)
shell.CurrentDirectory = projectDir
nodeExe = "C:\Users\zhoun\Documents\Codex\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node"
mysqlExe = "D:\mysql\mysql-8.4.10-winx64\bin\mysqld.exe"
q = Chr(34)

Function IsProcessRunning(processName)
  Set service = GetObject("winmgmts:\\.\root\cimv2")
  Set processes = service.ExecQuery("SELECT * FROM Win32_Process WHERE Name='" & processName & "'")
  IsProcessRunning = processes.Count > 0
End Function

If fso.FileExists(mysqlExe) And Not IsProcessRunning("mysqld.exe") Then
  mysqlCmd = q & mysqlExe & q & " --basedir=D:\mysql\mysql-8.4.10-winx64 --datadir=D:\mysql\data --port=3306 --log-error=D:\mysql\logs\mysql.err"
  shell.Run mysqlCmd, 0, False
  WScript.Sleep 5000
End If

apiCmd = "cmd.exe /d /c " & q & q & nodeExe & q & " apps\api\dist\main.js >> api-run.log 2>> api-run.err.log" & q
webCmd = "cmd.exe /d /c " & q & q & nodeExe & q & " node_modules\vite\bin\vite.js apps\web --host 0.0.0.0 --port 5174 --strictPort >> web-run.log 2>> web-run.err.log" & q

shell.Run apiCmd, 0, False
shell.Run webCmd, 0, False

