' Chess and Cards GM 运营管理中台无黑框启动脚本
Set ws = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

exePub = currentDir & "\tools\CcGmClient\publish\CcGmClient.exe"
exeRel = currentDir & "\tools\CcGmClient\bin\Release\net10.0-windows\CcGmClient.exe"
exeDbg = currentDir & "\tools\CcGmClient\bin\Debug\net10.0-windows\CcGmClient.exe"

If fso.FileExists(exePub) Then
    ws.Run """" & exePub & """", 1, False
ElseIf fso.FileExists(exeRel) Then
    ws.Run """" & exeRel & """", 1, False
ElseIf fso.FileExists(exeDbg) Then
    ws.Run """" & exeDbg & """", 1, False
Else
    ws.Run "cmd /c """ & currentDir & "\GM工具.bat""", 1, False
End If