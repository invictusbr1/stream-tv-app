' Abre o Painel do Conecta TV sem janela preta de terminal.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = pasta
sh.Run "node """ & pasta & "\painel\painel.cjs""", 0, False
