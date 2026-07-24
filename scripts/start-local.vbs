Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)
shell.CurrentDirectory = projectDir
nodeExe = "C:\Users\zhoun\Documents\Codex\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node"
mysqlExe = "D:\mysql\mysql-8.4.10-winx64\bin\mysqld.exe"
q = Chr(34)

Function IsPortListening(port)
  command = "cmd.exe /d /c netstat -ano | findstr /C:" & q & ":" & port & " " & q
  Set exec = shell.Exec(command)
  output = exec.StdOut.ReadAll
  IsPortListening = InStr(output, "LISTENING") > 0
End Function

Sub WaitForPort(port, seconds)
  For i = 1 To seconds
    If IsPortListening(port) Then Exit Sub
    WScript.Sleep 1000
  Next
End Sub

If Not IsPortListening(3306) Then
  WScript.Echo "Starting MySQL..."
  If Not fso.FileExists(mysqlExe) Then
    WScript.Echo "MySQL not found: " & mysqlExe
  Else
    mysqlCmd = q & mysqlExe & q & " --basedir=D:\mysql\mysql-8.4.10-winx64 --datadir=D:\mysql\data --port=3306 --log-error=D:\mysql\logs\mysql.err"
    shell.Run mysqlCmd, 0, False
    WaitForPort 3306, 20
  End If
Else
  WScript.Echo "MySQL is already running."
End If

If Not IsPortListening(4000) Then
  If IsPortListening(3306) Then
    WScript.Echo "Starting API..."
    apiCmd = "cmd.exe /d /c " & q & q & nodeExe & q & " apps\api\dist\main.js >> api-run.log 2>> api-run.err.log" & q
    shell.Run apiCmd, 0, False
    WaitForPort 4000, 20
  Else
    WScript.Echo "MySQL did not start. API skipped."
    WScript.Echo "Check log: D:\mysql\logs\mysql.err"
  End If
Else
  WScript.Echo "API is already running."
End If

If Not IsPortListening(5174) Then
  WScript.Echo "Starting Web..."
  webCmd = "cmd.exe /d /c " & q & q & nodeExe & q & " node_modules\vite\bin\vite.js apps\web --host 0.0.0.0 --port 5174 --strictPort >> web-run.log 2>> web-run.err.log" & q
  shell.Run webCmd, 0, False
  WaitForPort 5174, 20
Else
  WScript.Echo "Web is already running."
End If

WScript.Echo "Start task finished."
WScript.Echo "Web: http://localhost:5174/"
WScript.Echo "API: http://localhost:4000/api"
